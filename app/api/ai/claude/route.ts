import Anthropic from "@anthropic-ai/sdk";
import { ANALYST_EFFORT, ANALYST_MODELS } from "@/lib/claude-models";

// Proxy for the AG Studio Claude adapter (components/analytics/claude-adapter.ts). The adapter runs
// in the browser and posts a Messages API request body here; this adds the server's key, pins the
// model to an allowlist, caps output, and streams Claude's raw events back as SSE. The key never
// reaches the browser.

const MODELS: readonly string[] = ANALYST_MODELS.map((m) => m.id);
const MAX_TOKENS = 16_000;

const error = (status: number, message: string) => Response.json({ error: { message } }, { status });

// The demo is public and this spends a real key: same-origin browsers only, and simple in-memory
// limits (one agent request can take dozens of model calls, so the per-visitor cap is generous).
const PER_IP_PER_HOUR = 600;
const GLOBAL_PER_DAY = 6000;
const hits = new Map<string, number[]>();
let day = { start: Date.now(), count: 0 };

function limited(ip: string): string | null {
  const now = Date.now();
  if (now - day.start > 864e5) day = { start: now, count: 0 };
  if (++day.count > GLOBAL_PER_DAY) return "The demo's daily AI budget is used up. Try again tomorrow.";
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600e3);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > PER_IP_PER_HOUR ? "Too many AI requests from this browser. Try again in an hour." : null;
}

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return error(503, "The analyst is not configured: set ANTHROPIC_API_KEY.");

  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return error(403, "Cross-origin requests are not allowed.");
  const tooMany = limited(request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local");
  if (tooMany) return error(429, tooMany);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error(400, "Request body must be JSON.");
  }
  const model = typeof body.model === "string" && MODELS.includes(body.model) ? body.model : MODELS[0];
  const { system, messages, tools, tool_choice } = body as Pick<Anthropic.MessageCreateParams, "system" | "messages" | "tools" | "tool_choice">;
  if (!Array.isArray(messages) || messages.length === 0) return error(400, "messages is required.");

  const debug = process.env.AI_DEBUG === "1";
  const client = new Anthropic();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        const events = await client.messages.create(
          {
            model,
            max_tokens: MAX_TOKENS,
            // Thinking off: Studio's conversation format can't carry thinking blocks (and their
            // signatures) back between tool calls. Haiku 5.5 allows this at effort high or below.
            thinking: { type: "disabled" },
            output_config: { effort: ANALYST_EFFORT },
            system,
            messages,
            ...(tools?.length ? { tools, tool_choice } : {}),
            stream: true,
          },
          { signal: request.signal },
        );
        const blocks: string[] = [];
        let stop = "";
        for await (const event of events) {
          if (debug && event.type === "content_block_start")
            blocks.push(event.content_block.type === "tool_use" ? `tool_use:${event.content_block.name}` : event.content_block.type);
          if (debug && event.type === "message_delta") stop = event.delta.stop_reason ?? "";
          send(event);
        }
        if (debug) {
          const last = messages.at(-1);
          const results = Array.isArray(last?.content) ? last.content.filter((b) => b.type === "tool_result") : [];
          for (const r of results) console.log(`[ai]   result: ${JSON.stringify(r).slice(0, 400)}`);
          const prev = messages.at(-2);
          const uses = Array.isArray(prev?.content) ? prev.content.filter((b) => b.type === "tool_use" && b.name === "delegate_to") : [];
          for (const u of uses) console.log(`[ai]   delegate_to input: ${JSON.stringify(u).slice(0, 600)}`);
          const d = tools?.find((t) => "name" in t && t.name === "delegate_to");
          if (d && process.env.AI_DEBUG_SCHEMA === "1") console.log(`[ai]   delegate_to schema: ${JSON.stringify(d).slice(0, 3000)}`);
        }
        if (debug)
          console.log(`[ai] ${String(system ?? "").slice(0, 60).replace(/\s+/g, " ")}… msgs=${messages.length} tools=${tools?.length ?? 0} choice=${JSON.stringify(tool_choice)} -> ${stop} [${blocks.join(", ")}]`);
      } catch (err) {
        if (!request.signal.aborted) {
          const message = err instanceof Anthropic.APIError ? `${err.status ?? ""} ${err.message}`.trim() : String(err);
          if (debug) console.log(`[ai] error: ${message}`);
          send({ type: "error", error: { type: "proxy_error", message } });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}
