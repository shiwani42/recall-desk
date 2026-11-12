import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgAiConversationItem, AgAiEvent, AgLlmRequest } from "ag-studio";
import { claudeAdapter } from "@/components/analytics/claude-adapter";

// A canned Claude stream: some text, then a tool call whose JSON arrives in two pieces.
const EVENTS = [
  { type: "message_start", message: { id: "msg_1", model: "claude-opus-5-5", usage: { input_tokens: 12 } } },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Checking " } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "exposure." } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_1", name: "recall_exposure", input: {} } },
  { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"skus":["HTR' } },
  { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '-200"]}' } },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 30 } },
  { type: "message_stop" },
];

function sse(events: unknown[]) {
  const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  // Split mid-frame to exercise buffering.
  const chunks = [body.slice(0, 37), body.slice(37, 300), body.slice(300)];
  return new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } }), { status: 200 });
}

const request = (input: AgAiConversationItem[], extra: Partial<AgLlmRequest> = {}): AgLlmRequest => ({
  input,
  instructions: "You are the analyst.",
  tools: [{ name: "recall_exposure", description: "d", parameters: { type: "object", properties: { skus: { type: "array" } } } }],
  responseFormat: { type: "text" },
  ...extra,
});

afterEach(() => vi.unstubAllGlobals());

describe("claudeAdapter", () => {
  it("turns Claude's stream into Studio events and output items", async () => {
    const fetchMock = vi.fn(async () => sse(EVENTS));
    vi.stubGlobal("fetch", fetchMock);
    const handler = claudeAdapter({ model: "claude-opus-5-5" }).executeTurn(
      request([{ id: "u1", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "Recall the heaters?" }] }]),
    );
    const events: AgAiEvent[] = [];
    for await (const e of handler.stream) events.push(e);
    const res = await handler.complete;

    expect(events.map((e) => e.type)).toEqual([
      "TEXT_MESSAGE_START", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_CONTENT", "TEXT_MESSAGE_END",
      "TOOL_CALL_START", "TOOL_CALL_ARGS", "TOOL_CALL_ARGS", "TOOL_CALL_END",
    ]);
    expect(res.status).toBe("completed");
    expect(res.output).toEqual([
      expect.objectContaining({ type: "message", content: [{ type: "text", text: "Checking exposure.", annotations: [] }] }),
      expect.objectContaining({ type: "function_call", callId: "toolu_1", name: "recall_exposure", arguments: '{"skus":["HTR-200"]}' }),
    ]);

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.system).toBe("You are the analyst.");
    expect(body.tools[0]).toMatchObject({ name: "recall_exposure", input_schema: { type: "object" } });
    expect(body.tool_choice).toEqual({ type: "auto" });
  });

  it("encodes tool calls and results as Claude tool_use / tool_result turns", async () => {
    const fetchMock = vi.fn(async () => sse([{ type: "message_start", message: { id: "m" } }, { type: "message_stop" }]));
    vi.stubGlobal("fetch", fetchMock);
    const handler = claudeAdapter({ model: "claude-opus-5-5" }).executeTurn(
      request([
        { id: "s", kind: "input", type: "message", role: "system", status: "completed", content: [{ type: "text", text: "Page: Recall response" }] },
        { id: "u", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "Recall the heaters?" }] },
        { id: "a", kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: "Checking.", annotations: [] }] },
        { id: "c1", kind: "output", type: "function_call", callId: "toolu_1", name: "recall_exposure", arguments: '{"skus":["HTR-200"]}' },
        { type: "function_call_output", callId: "toolu_1", output: '{"exposure":649.87}', status: "completed" },
      ]),
    );
    for await (const e of handler.stream) void e;
    await handler.complete;

    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.system).toBe("You are the analyst.\n\nPage: Recall response");
    expect(body.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "Recall the heaters?" }] },
      { role: "assistant", content: [{ type: "text", text: "Checking." }, { type: "tool_use", id: "toolu_1", name: "recall_exposure", input: { skus: ["HTR-200"] } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"exposure":649.87}' }] },
    ]);
  });

  it("answers a JSON response format through a forced tool, streamed as text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      sse([
        { type: "message_start", message: { id: "m" } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t", name: "respond_with_json", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"title":"Heaters"}' } },
        { type: "content_block_stop", index: 0 },
        { type: "message_stop" },
      ]),
    ));
    const handler = claudeAdapter({ model: "claude-opus-5-5" }).executeTurn(
      request([{ id: "u", kind: "input", type: "message", role: "user", status: "completed", content: [{ type: "text", text: "Name it" }] }], {
        responseFormat: { type: "json", name: "thread_title", schema: { type: "object", properties: { title: { type: "string" } } } },
      }),
    );
    for await (const e of handler.stream) void e;
    const res = await handler.complete;
    expect(res.output).toEqual([expect.objectContaining({ type: "message", content: [{ type: "text", text: '{"title":"Heaters"}', annotations: [] }] })]);
  });

  it("rejects `complete` with the proxy's error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "The analyst is not configured" } }, { status: 503 })));
    const handler = claudeAdapter({ model: "claude-opus-5-5" }).executeTurn(request([]));
    for await (const e of handler.stream) void e;
    await expect(handler.complete).rejects.toThrow("The analyst is not configured");
  });
});
