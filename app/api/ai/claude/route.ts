import Anthropic from "@anthropic-ai/sdk";
import { ANALYST_MODELS } from "@/lib/claude-models";

// Proxy for the AG Studio Claude adapter (components/analytics/claude-adapter.ts). The adapter runs
// in the browser and posts a Messages API request body here; this adds the server's key, pins the
// model to an allowlist, caps output, and streams Claude's raw events back as SSE. The key never
// reaches the browser.

const MODELS: readonly string[] = ANALYST_MODELS.map((m) => m.id);
const MAX_TOKENS = 16_000;

const error = (status: number, message: string) => Response.json({ error: { message } }, { status });

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) return error(503, "The analyst is not configured: set ANTHROPIC_API_KEY.");

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return error(400, "Request body must be JSON.");
  }
  const model = typeof body.model === "string" && MODELS.includes(body.model) ? body.model : MODELS[0];
  const { system, messages, tools, tool_choice } = body as Pick<Anthropic.MessageCreateParams, "system" | "messages" | "tools" | "tool_choice">;
  if (!Array.isArray(messages) || messages.length === 0) return error(400, "messages is required.");

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
            system,
            messages,
            ...(tools?.length ? { tools, tool_choice } : {}),
            stream: true,
          },
          { signal: request.signal },
        );
        for await (const event of events) send(event);
      } catch (err) {
        if (!request.signal.aborted) {
          const message = err instanceof Anthropic.APIError ? `${err.status ?? ""} ${err.message}`.trim() : String(err);
          send({ type: "error", error: { type: "proxy_error", message } });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
}
