import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DifyChatLanguageModel } from "./dify-chat-language-model";

// Mock fetch globally
let fetchMock: any;
beforeEach(() => {
  (global as any).fetch = (...args: any[]) => fetchMock(...args);
});
afterEach(() => {
  fetchMock = undefined;
});

function makeModel(overrides: any = {}) {
  return new DifyChatLanguageModel(
    "test-model" as any,
    {},
    {
      provider: "dify",
      baseURL: "https://mock.api",
      headers: () => ({ Authorization: "Bearer test" }),
      ...overrides,
    }
  );
}

describe("DifyChatLanguageModel", () => {
  it("should handle blocking response (doGenerate)", async () => {
    fetchMock = async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          id: "id1",
          answer: "Hello world",
          task_id: "task1",
          conversation_id: "conv1",
          metadata: {
            usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
          },
        }),
      status: 200,
    });
    const model = makeModel();
    const result = await model.doGenerate({
      messages: [{ role: "user", content: "Hi" }],
      headers: {},
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [],
    });
    expect(result).toMatchSnapshot();
    expect(result.providerMetadata).toBeDefined();
    expect(result.providerMetadata?.difyWorkflowData).toBeDefined();
    expect(result.providerMetadata?.difyWorkflowData?.conversationId).toBe(
      "conv1"
    );
    expect(
      result.providerMetadata?.difyWorkflowData?.messageId
    ).toBeUndefined();
  });

  it("should handle streaming message and workflow_finished events", async () => {
    const events = [
      "data: " +
        JSON.stringify({ event: "message", answer: "Hel", id: "msg1" }),
      "data: " + JSON.stringify({ event: "message", answer: "lo", id: "msg1" }),
      "data: " +
        JSON.stringify({
          event: "workflow_finished",
          data: { total_tokens: 42 },
          conversation_id: "conv1",
          message_id: "msg1",
        }),
      "",
    ];
    let idx = 0;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (idx < events.length) {
          controller.enqueue(encoder.encode(events[idx++] + "\n"));
        } else {
          controller.close();
        }
      },
    });
    fetchMock = async () => ({
      ok: true,
      body: stream,
      status: 200,
    });
    const model = makeModel();
    const { stream: resultStream } = await model.doStream({
      messages: [{ role: "user", content: "Hi" }],
      headers: {},
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [],
    });
    const parts: any[] = [];
    const reader = resultStream.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    expect(parts).toMatchSnapshot();
    const finishPart = parts.find((p) => p.type === "finish");
    expect(finishPart?.providerMetadata).toBeDefined();
    expect(finishPart?.providerMetadata?.difyWorkflowData).toBeDefined();
    expect(finishPart?.providerMetadata?.difyWorkflowData?.conversationId).toBe(
      "conv1"
    );
    expect(finishPart?.providerMetadata?.difyWorkflowData?.messageId).toBe(
      "msg1"
    );
  });

  it("should throw on API error", async () => {
    fetchMock = async () => ({
      ok: false,
      text: async () => "Bad request",
      status: 400,
    });
    const model = makeModel();
    let error: any = undefined;
    try {
      await model.doGenerate({
        messages: [{ role: "user", content: "Hi" }],
        headers: {},
        inputFormat: "messages",
        mode: { type: "regular" },
        prompt: [],
      });
    } catch (e) {
      error = e;
    }
    expect({ name: error?.name, message: error?.message }).toMatchSnapshot();
  });

  it("should skip malformed event without throwing", async () => {
    const events = ["data: not-json", ""];
    let idx = 0;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (idx < events.length) {
          controller.enqueue(encoder.encode(events[idx++] + "\n"));
        } else {
          controller.close();
        }
      },
    });
    fetchMock = async () => ({
      ok: true,
      body: stream,
      status: 200,
    });
    const model = makeModel();
    const { stream: resultStream } = await model.doStream({
      messages: [{ role: "user", content: "Hi" }],
      headers: {},
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [],
    });
    const reader = resultStream.getReader();
    const result = await reader.read();
    expect(result).toMatchSnapshot();
  });

  it("should merge headers from options with headers from this.headers()", async () => {
    let capturedHeaders: Record<string, string> = {};
    fetchMock = async (url: string, options: any) => {
      capturedHeaders = options.headers;
      return {
        ok: true,
        text: async () =>
          JSON.stringify({
            id: "id1",
            answer: "Hello world",
            task_id: "task1",
            conversation_id: "conv1",
            metadata: {
              usage: {
                prompt_tokens: 5,
                completion_tokens: 7,
                total_tokens: 12,
              },
            },
          }),
        status: 200,
      };
    };

    const model = makeModel();
    await model.doGenerate({
      messages: [{ role: "user", content: "Hi" }],
      headers: { "Custom-Header": "custom-value" },
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [],
    });

    expect(capturedHeaders["Authorization"]).toBe("Bearer test");
    expect(capturedHeaders["Custom-Header"]).toBe("custom-value");
  });
});
