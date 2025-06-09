import { describe, it, expect } from "vitest";
import { DifyChatLanguageModel } from "./dify-chat-language-model";

function createMockFetch(mockResponse: any) {
  return async () => mockResponse;
}

function makeModel(overrides: any = {}) {
  const mockFetch = overrides.fetch || createMockFetch({});
  return new DifyChatLanguageModel(
    "test-model" as any,
    {},
    {
      provider: "dify",
      baseURL: "https://mock.api",
      headers: () => ({ Authorization: "Bearer test" }),
      fetch: mockFetch,
      ...overrides,
    }
  );
}

describe("DifyChatLanguageModel", () => {
  it("should handle blocking response (doGenerate)", async () => {
    const mockFetch = createMockFetch({
      ok: true,
      headers: new Map([["Content-Type", "application/json"]]),
      text: async () =>
        JSON.stringify({
          id: "id1",
          answer: "Hello world",
          task_id: "task1",
          conversation_id: "conv1",
          message_id: "msg1",
          metadata: {
            usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
          },
        }),
      status: 200,
    });

    const model = makeModel({ fetch: mockFetch });
    const result = await model.doGenerate({
      messages: [{ role: "user", content: "Hi" }],
      headers: {},
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [],
    });

    // Validate important fields without using snapshot
    expect(result.text).toBe("Hello world");
    expect(result.usage.promptTokens).toBe(5);
    expect(result.usage.completionTokens).toBe(7);
    expect(result.providerMetadata).toBeDefined();
    expect(result.providerMetadata?.difyWorkflowData).toBeDefined();
    expect(result.providerMetadata?.difyWorkflowData?.conversationId).toBe(
      "conv1"
    );
    expect(result.providerMetadata?.difyWorkflowData?.messageId).toBe("msg1");
  });

  it("should handle streaming message events", async () => {
    // Proper SSE format with each event separated by double newlines
    const mockResponseText =
      `data: {"event":"message","answer":"Hel","id":"msg1"}\n\n` +
      `data: {"event":"message","answer":"lo","id":"msg1"}\n\n` +
      `data: {"event":"workflow_finished","workflow_run_id":"wfr1","data":{"id":"wf1","workflow_id":"wfid1","total_tokens":42,"created_at":1625097600000},"conversation_id":"conv1","message_id":"msg1"}\n\n`;

    // Create a mock for the fetch function with a readable stream response
    const mockFetch = createMockFetch({
      ok: true,
      headers: new Map([["Content-Type", "text/event-stream"]]),
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(mockResponseText));
          controller.close();
        },
      }),
      status: 200,
    });

    const model = makeModel({ fetch: mockFetch });
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

    // Check we have text-delta parts
    const textDeltaParts = parts.filter((p) => p.type === "text-delta");
    expect(textDeltaParts.length).toBe(2);
    expect(textDeltaParts[0].textDelta).toBe("Hel");
    expect(textDeltaParts[1].textDelta).toBe("lo");

    // Check finish part
    const finishPart = parts.find((p) => p.type === "finish");
    expect(finishPart).toBeDefined();
    expect(finishPart?.providerMetadata).toBeDefined();
    expect(finishPart?.providerMetadata?.difyWorkflowData).toBeDefined();
    expect(finishPart?.providerMetadata?.difyWorkflowData?.conversationId).toBe(
      "conv1"
    );
    expect(finishPart?.providerMetadata?.difyWorkflowData?.messageId).toBe(
      "msg1"
    );
    expect(finishPart?.usage?.completionTokens).toBe(42);
  });

  it("should handle workflow events in streaming mode", async () => {
    // Proper SSE format with each event separated by double newlines
    const mockResponseText =
      `data: {"event":"workflow_started","workflow_run_id":"wfr1","data":{"id":"wf1","workflow_id":"wfid1","created_at":1625097600000}}\n\n` +
      `data: {"event":"node_started","workflow_run_id":"wfr1","data":{"id":"node1","node_id":"n1","node_type":"llm"}}\n\n` +
      `data: {"event":"message","answer":"Hello","id":"msg1"}\n\n` +
      `data: {"event":"node_finished","workflow_run_id":"wfr1","data":{"id":"node1","node_id":"n1","node_type":"llm"}}\n\n` +
      `data: {"event":"workflow_finished","workflow_run_id":"wfr1","data":{"id":"wf1","workflow_id":"wfid1","total_tokens":15,"created_at":1625097600000},"conversation_id":"conv1","message_id":"msg1"}\n\n`;

    // Create a mock for the fetch function with a readable stream response
    const mockFetch = createMockFetch({
      ok: true,
      headers: new Map([["Content-Type", "text/event-stream"]]),
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(mockResponseText));
          controller.close();
        },
      }),
      status: 200,
    });

    const model = makeModel({ fetch: mockFetch });
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

    // Verify we get text delta from message event
    const textDeltaPart = parts.find((p) => p.type === "text-delta");
    expect(textDeltaPart).toBeDefined();
    expect(textDeltaPart?.textDelta).toBe("Hello");

    // Verify finish part from workflow_finished event
    const finishPart = parts.find((p) => p.type === "finish");
    expect(finishPart).toBeDefined();
    expect(finishPart?.providerMetadata?.difyWorkflowData?.conversationId).toBe(
      "conv1"
    );
    expect(finishPart?.providerMetadata?.difyWorkflowData?.messageId).toBe(
      "msg1"
    );
    expect(finishPart?.usage?.completionTokens).toBe(15);
  });

  it("should ignore non-handled event types in streaming mode", async () => {
    // Proper SSE format with each event separated by double newlines
    const mockResponseText =
      `data: {"event":"tts_message","audio":"base64audio1","conversation_id":"conv1","message_id":"msg1"}\n\n` +
      `data: {"event":"message","answer":"Text response","id":"msg1"}\n\n` +
      `data: {"event":"tts_message_end","audio":"base64audio2","conversation_id":"conv1","message_id":"msg1"}\n\n` +
      `data: {"event":"workflow_finished","workflow_run_id":"wfr1","data":{"id":"wf1","workflow_id":"wfid1","total_tokens":10,"created_at":1625097600000},"conversation_id":"conv1","message_id":"msg1"}\n\n`;

    // Create a mock for the fetch function with a readable stream response
    const mockFetch = createMockFetch({
      ok: true,
      headers: new Map([["Content-Type", "text/event-stream"]]),
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(mockResponseText));
          controller.close();
        },
      }),
      status: 200,
    });

    const model = makeModel({ fetch: mockFetch });
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

    // Check text-delta parts
    const textDeltaPart = parts.find((p) => p.type === "text-delta");
    expect(textDeltaPart).toBeDefined();
    expect(textDeltaPart?.textDelta).toBe("Text response");

    // Check finish part
    const finishPart = parts.find((p) => p.type === "finish");
    expect(finishPart).toBeDefined();
    expect(finishPart?.providerMetadata?.difyWorkflowData?.conversationId).toBe(
      "conv1"
    );
    expect(finishPart?.providerMetadata?.difyWorkflowData?.messageId).toBe(
      "msg1"
    );
  });

  it("should skip malformed event without throwing", async () => {
    const mockResponseText = `data: not-json\n\n`;

    const mockFetch = createMockFetch({
      ok: true,
      headers: new Map([["Content-Type", "text/event-stream"]]),
      body: new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(mockResponseText));
          controller.close();
        },
      }),
      status: 200,
    });

    const model = makeModel({ fetch: mockFetch });

    // The main thing we're testing is that it doesn't throw an exception
    // when receiving malformed data
    await expect(async () => {
      const { stream: resultStream } = await model.doStream({
        messages: [{ role: "user", content: "Hi" }],
        headers: {},
        inputFormat: "messages",
        mode: { type: "regular" },
        prompt: [],
      });

      const reader = resultStream.getReader();

      // Read all stream content
      while (true) {
        const { done } = await reader.read();
        if (done) break;
      }
    }).not.toThrow();
  });

  it("should throw on API error", async () => {
    const mockFetch = createMockFetch({
      ok: false,
      headers: new Map([["Content-Type", "application/json"]]),
      text: async () =>
        JSON.stringify({
          code: "400",
          message: "Bad Request: Invalid input parameters",
          status: 400,
        }),
      status: 400,
    });

    const model = makeModel({ fetch: mockFetch });
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
    expect(error?.name).toBe("AI_APICallError");
    expect(error?.message).toBe(
      "Dify API error: Bad Request: Invalid input parameters"
    );
  });

  it("should merge headers from options with headers from this.headers()", async () => {
    let capturedUrl: string = "";
    let capturedOptions: any = {};

    const mockFetch = async (url: string, options: any) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        headers: new Map([["Content-Type", "application/json"]]),
        text: async () =>
          JSON.stringify({
            id: "id1",
            answer: "Hello world",
            task_id: "task1",
            conversation_id: "conv1",
            message_id: "msg1",
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

    const model = makeModel({ fetch: mockFetch });
    await model.doGenerate({
      messages: [{ role: "user", content: "Hi" }],
      headers: { "Custom-Header": "custom-value" },
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [],
    });

    expect(capturedOptions.headers["Authorization"]).toBe("Bearer test");
    expect(capturedOptions.headers["Custom-Header"]).toBe("custom-value");
  });

  it("should use default user-id when no user-id is provided", async () => {
    let capturedRequestBody: any = {};

    const mockFetch = async (url: string, options: any) => {
      capturedRequestBody = JSON.parse(options.body);
      return {
        ok: true,
        headers: new Map([["Content-Type", "application/json"]]),
        text: async () =>
          JSON.stringify({
            id: "id1",
            answer: "Hello world",
            task_id: "task1",
            conversation_id: "conv1",
            message_id: "msg1",
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

    const model = makeModel({ fetch: mockFetch });
    await model.doGenerate({
      messages: [{ role: "user", content: "Hi" }],
      headers: {}, // No user-id provided
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [],
    });

    // Verify that the default user-id is used
    expect(capturedRequestBody.user).toBe("you_should_pass_user-id");
  });

  it("should use provided user-id when explicitly set", async () => {
    let capturedRequestBody: any = {};

    const mockFetch = async (url: string, options: any) => {
      capturedRequestBody = JSON.parse(options.body);
      return {
        ok: true,
        headers: new Map([["Content-Type", "application/json"]]),
        text: async () =>
          JSON.stringify({
            id: "id1",
            answer: "Hello world",
            task_id: "task1",
            conversation_id: "conv1",
            message_id: "msg1",
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

    const model = makeModel({ fetch: mockFetch });
    await model.doGenerate({
      messages: [{ role: "user", content: "Hi" }],
      headers: { "user-id": "custom-user-123" }, // Explicit user-id provided
      inputFormat: "messages",
      mode: { type: "regular" },
      prompt: [],
    });

    // Verify that the provided user-id is used instead of default
    expect(capturedRequestBody.user).toBe("custom-user-123");
  });
});
