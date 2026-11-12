// AG Studio LLM adapter for Claude. AG Studio ships no adapters (its docs give an OpenAI one to copy);
// this one speaks the Anthropic Messages API instead. It runs in the browser and posts to this app's
// /api/ai/claude proxy, which holds the key.
//
// Studio's side is OpenAI-Responses shaped (conversation items in, AG-UI events out). Claude's side is
// messages of content blocks in, stream events out. The translation:
//   input/user message          -> user text block        (system-role inputs join the system prompt)
//   output message              -> assistant text block
//   function_call               -> assistant tool_use block (id = callId)
//   function_call_output        -> user tool_result block
//   reasoning                   -> dropped (we don't request thinking, so none is produced)
// A JSON response format becomes a forced tool whose input is the JSON, streamed as text.

import type {
  AgAiConversationItem,
  AgAiEvent,
  AgAiOutputItem,
  AgAiToolSchema,
  AgLlmAdapter,
  AgLlmRequest,
  AgLlmResponse,
  AgLlmResponseHandler,
} from "ag-studio";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };
type Message = { role: "user" | "assistant"; content: Block[] };

const JSON_TOOL = "respond_with_json";

function encode(items: AgAiConversationItem[]): { system: string[]; messages: Message[] } {
  const system: string[] = [];
  const messages: Message[] = [];
  const push = (role: Message["role"], block: Block) => {
    const last = messages.at(-1);
    if (last?.role === role) {
      // Tool results must come first in a user turn.
      if (block.type === "tool_result") {
        const firstOther = last.content.findIndex((b) => b.type !== "tool_result");
        if (firstOther === -1) last.content.push(block);
        else last.content.splice(firstOther, 0, block);
      } else last.content.push(block);
    } else messages.push({ role, content: [block] });
  };

  for (const item of items) {
    switch (item.type) {
      case "message": {
        const text = item.content
          .map((c) => (c.type === "text" ? c.text : c.type === "refusal" ? c.refusal : ""))
          .filter(Boolean)
          .join("\n");
        if (!text) break;
        if (item.kind === "input" && item.role === "system") system.push(text);
        else push(item.kind === "input" ? "user" : "assistant", { type: "text", text });
        break;
      }
      case "function_call":
        push("assistant", { type: "tool_use", id: item.callId, name: item.name, input: parseArgs(item.arguments) });
        break;
      case "function_call_output":
        push("user", { type: "tool_result", tool_use_id: item.callId, content: item.output || "(no output)" });
        break;
      default:
        break; // reasoning
    }
  }
  if (messages[0]?.role !== "user") messages.unshift({ role: "user", content: [{ type: "text", text: "Continue." }] });
  return { system, messages };
}

function parseArgs(json: string): unknown {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

const toTool = (t: AgAiToolSchema) => ({
  name: t.name,
  description: t.description,
  input_schema: { type: "object", ...(t.parameters as object) },
});

function buildBody(request: AgLlmRequest, defaultModel: string) {
  const { system, messages } = encode(request.input);
  const json = request.responseFormat?.type === "json" ? request.responseFormat : null;
  const tools = (request.tools ?? []).map(toTool);
  let tool_choice: unknown;
  if (json) {
    tools.push({ name: JSON_TOOL, description: json.description ?? `Give the final answer as ${json.name}.`, input_schema: { type: "object", ...(json.schema as object) } });
    tool_choice = { type: "tool", name: JSON_TOOL };
  } else if (request.toolChoice === "required") tool_choice = { type: "any" };
  else if (request.toolChoice === "none") tool_choice = { type: "none" };
  else if (request.toolChoice && typeof request.toolChoice === "object") tool_choice = { type: "tool", name: request.toolChoice.name };
  else if (tools.length) tool_choice = { type: "auto" };

  return {
    model: request.model?.id ?? defaultModel,
    system: [request.instructions, ...system].filter(Boolean).join("\n\n") || undefined,
    messages,
    tools,
    tool_choice,
  };
}

type Open = { kind: "text" | "tool" | "json"; id: string; name?: string; text: string };

/** Claude stream events -> AG-UI events, collecting the final output as it goes. */
class Translator {
  private open = new Map<number, Open>();
  readonly output: AgAiOutputItem[] = [];
  id = `msg_${crypto.randomUUID()}`;
  model?: string;
  stopReason?: string;
  usage = { inputTokens: 0, outputTokens: 0 };
  error?: Error;

  // Claude's stream events, as parsed JSON.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  translate(e: Record<string, any>): AgAiEvent[] {
    switch (e.type) {
      case "message_start":
        this.id = e.message?.id ?? this.id;
        this.model = e.message?.model;
        this.usage.inputTokens = e.message?.usage?.input_tokens ?? 0;
        return [];
      case "content_block_start": {
        const b = e.content_block;
        const id = `${this.id}_${e.index}`;
        if (b?.type === "text") {
          this.open.set(e.index, { kind: "text", id, text: b.text ?? "" });
          return [{ type: "TEXT_MESSAGE_START", messageId: id, role: "assistant" } as AgAiEvent];
        }
        if (b?.type === "tool_use" && b.name === JSON_TOOL) {
          this.open.set(e.index, { kind: "json", id, text: "" });
          return [{ type: "TEXT_MESSAGE_START", messageId: id, role: "assistant" } as AgAiEvent];
        }
        if (b?.type === "tool_use") {
          this.open.set(e.index, { kind: "tool", id: b.id, name: b.name, text: "" });
          return [{ type: "TOOL_CALL_START", toolCallId: b.id, toolCallName: b.name } as AgAiEvent];
        }
        return [];
      }
      case "content_block_delta": {
        const o = this.open.get(e.index);
        const d = e.delta;
        if (!o || !d) return [];
        const delta = d.type === "text_delta" ? d.text : d.type === "input_json_delta" ? d.partial_json : "";
        if (!delta) return [];
        o.text += delta;
        return o.kind === "tool"
          ? [{ type: "TOOL_CALL_ARGS", toolCallId: o.id, delta } as AgAiEvent]
          : [{ type: "TEXT_MESSAGE_CONTENT", messageId: o.id, delta } as AgAiEvent];
      }
      case "content_block_stop": {
        const o = this.open.get(e.index);
        if (!o) return [];
        this.open.delete(e.index);
        if (o.kind === "tool") {
          this.output.push({ id: o.id, kind: "output", type: "function_call", callId: o.id, name: o.name!, arguments: o.text || "{}", status: "completed" });
          return [{ type: "TOOL_CALL_END", toolCallId: o.id } as AgAiEvent];
        }
        this.output.push({
          id: o.id,
          kind: "output",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "text", text: o.text, annotations: [] }],
        });
        return [{ type: "TEXT_MESSAGE_END", messageId: o.id } as AgAiEvent];
      }
      case "message_delta":
        this.stopReason = e.delta?.stop_reason ?? this.stopReason;
        this.usage.outputTokens = e.usage?.output_tokens ?? this.usage.outputTokens;
        return [];
      case "error":
        this.error ??= new Error(e.error?.message ?? "Claude returned an error.");
        return [];
      default:
        return [];
    }
  }

  response(): AgLlmResponse {
    const incomplete = this.stopReason === "max_tokens";
    return {
      id: this.id,
      createdAt: Date.now(),
      output: this.output,
      status: incomplete ? "incomplete" : "completed",
      ...(incomplete && { incompleteDetails: { reason: "max_output_tokens" as const } }),
      model: this.model,
      usage: { inputTokens: this.usage.inputTokens, outputTokens: this.usage.outputTokens, totalTokens: this.usage.inputTokens + this.usage.outputTokens } as AgLlmResponse["usage"],
    };
  }
}

async function* streamClaude(endpoint: string, body: unknown, t: Translator, signal?: AbortSignal): AsyncIterableIterator<AgAiEvent> {
  const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${res.status}`);
  }
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        try {
          yield* t.translate(JSON.parse(line.slice(6)));
        } catch (err) {
          t.error ??= err instanceof Error ? err : new Error(String(err));
        }
      }
    }
  }
}

export function claudeAdapter({ endpoint = "/api/ai/claude", model }: { endpoint?: string; model: string }): AgLlmAdapter {
  return {
    executeTurn(request, options): AgLlmResponseHandler {
      const t = new Translator();
      let resolve!: (r: AgLlmResponse) => void;
      let reject!: (e: Error) => void;
      const complete = new Promise<AgLlmResponse>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      // A failed turn is reported once, through `complete`; mark it observed for consumers that
      // stop reading early.
      void complete.catch(() => {});

      async function* run(): AsyncIterableIterator<AgAiEvent> {
        try {
          yield* streamClaude(endpoint, buildBody(request, model), t, options?.signal);
        } catch (err) {
          t.error ??= err instanceof Error ? err : new Error(String(err));
        }
        if (t.error) reject(t.error);
        else resolve(t.response());
      }
      const it = run();
      return { stream: { [Symbol.asyncIterator]: () => it }, complete };
    },
  };
}
