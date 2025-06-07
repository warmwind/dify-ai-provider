import {
  APICallError,
  type JSONValue,
  type LanguageModelV1,
  type LanguageModelV1CallOptions,
  type LanguageModelV1FinishReason,
  type LanguageModelV1ObjectGenerationMode,
  type LanguageModelV1StreamPart,
} from "@ai-sdk/provider";
import {
  combineHeaders,
  createEventSourceResponseHandler,
  createJsonErrorResponseHandler,
  createJsonResponseHandler,
  FetchFunction,
  generateId,
  postJsonToApi,
  type ParseResult,
} from "@ai-sdk/provider-utils";
import { z } from "zod";
import type { DifyChatModelId, DifyChatSettings } from "./dify-chat-settings";

interface ModelConfig {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: FetchFunction;
}

const completionResponseSchema = z.object({
  id: z.string(),
  answer: z.string(),
  task_id: z.string(),
  conversation_id: z.string(),
  message_id: z.string(),
  metadata: z.object({
    usage: z.object({
      completion_tokens: z.number(),
      prompt_tokens: z.number(),
      total_tokens: z.number(),
    }),
  }),
});

const errorResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  detail: z.optional(z.record(z.unknown())),
});

const difyFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: errorResponseSchema,
  errorToMessage: (data) => `Dify API error: ${data.message}`,
});

// For TypeScript compatibility
interface ExtendedLanguageModelV1CallOptions
  extends LanguageModelV1CallOptions {
  messages?: Array<{
    role: string;
    content: string | Array<string | { type: string; [key: string]: any }>;
  }>;
}

// Define a base schema with common fields that all events might have
const difyStreamEventBase = z
  .object({
    event: z.string(),
    conversation_id: z.string().optional(),
    message_id: z.string().optional(),
    task_id: z.string().optional(),
    created_at: z.number().optional(),
  })
  .passthrough();

// Create schemas for specific event types
const workflowStartedSchema = difyStreamEventBase.extend({
  event: z.literal("workflow_started"),
  workflow_run_id: z.string(),
  data: z
    .object({
      id: z.string(),
      workflow_id: z.string(),
      created_at: z.number(),
    })
    .passthrough(),
});

const workflowFinishedSchema = difyStreamEventBase.extend({
  event: z.literal("workflow_finished"),
  workflow_run_id: z.string(),
  data: z
    .object({
      id: z.string(),
      workflow_id: z.string(),
      total_tokens: z.number().optional(),
      created_at: z.number(),
    })
    .passthrough(),
});

const nodeStartedSchema = difyStreamEventBase.extend({
  event: z.literal("node_started"),
  workflow_run_id: z.string(),
  data: z
    .object({
      id: z.string(),
      node_id: z.string(),
      node_type: z.string(),
    })
    .passthrough(),
});

const nodeFinishedSchema = difyStreamEventBase.extend({
  event: z.literal("node_finished"),
  workflow_run_id: z.string(),
  data: z
    .object({
      id: z.string(),
      node_id: z.string(),
      node_type: z.string(),
    })
    .passthrough(),
});

const messageSchema = difyStreamEventBase.extend({
  event: z.literal("message"),
  id: z.string().optional(),
  answer: z.string(),
  from_variable_selector: z.array(z.string()).optional(),
});

const messageEndSchema = difyStreamEventBase.extend({
  event: z.literal("message_end"),
  id: z.string(),
  metadata: z
    .object({
      usage: z
        .object({
          prompt_tokens: z.number(),
          completion_tokens: z.number(),
          total_tokens: z.number(),
        })
        .passthrough(),
    })
    .passthrough(),
  files: z.array(z.unknown()).optional(),
});

const ttsMessageSchema = difyStreamEventBase.extend({
  event: z.literal("tts_message"),
  audio: z.string(),
});

const ttsMessageEndSchema = difyStreamEventBase.extend({
  event: z.literal("tts_message_end"),
  audio: z.string(),
});

// Combine all schemas with discriminatedUnion
const difyStreamEventSchema = z
  .discriminatedUnion("event", [
    workflowStartedSchema,
    workflowFinishedSchema,
    nodeStartedSchema,
    nodeFinishedSchema,
    messageSchema,
    messageEndSchema,
    ttsMessageSchema,
    ttsMessageEndSchema,
  ])
  .or(difyStreamEventBase); // Fallback for any other event types

type DifyStreamEvent = z.infer<typeof difyStreamEventSchema>;

export class DifyChatLanguageModel implements LanguageModelV1 {
  readonly specificationVersion = "v1";
  readonly modelId: string;
  readonly defaultObjectGenerationMode: LanguageModelV1ObjectGenerationMode =
    undefined;

  private readonly generateId: () => string;
  private readonly chatMessagesEndpoint: string;
  private readonly config: ModelConfig;

  constructor(
    modelId: DifyChatModelId,
    private settings: DifyChatSettings,
    config: ModelConfig
  ) {
    this.modelId = modelId;
    this.config = config;
    this.generateId = generateId;
    this.chatMessagesEndpoint = `${this.config.baseURL}/chat-messages`;

    // Make sure we set a default response mode
    if (!this.settings.responseMode) {
      this.settings.responseMode = "streaming";
    }
  }

  get provider(): string {
    return this.config.provider;
  }

  async doGenerate(
    options: ExtendedLanguageModelV1CallOptions
  ): Promise<Awaited<ReturnType<LanguageModelV1["doGenerate"]>>> {
    const { abortSignal } = options;
    const requestBody = this.getRequestBody(options);

    const { responseHeaders, value: data } = await postJsonToApi({
      url: this.chatMessagesEndpoint,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: requestBody,
      abortSignal,
      failedResponseHandler: difyFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        completionResponseSchema
      ),
      fetch: this.config.fetch,
    });

    return {
      text: data.answer,
      toolCalls: [], // Dify doesn't currently support tool calls
      finishReason: "stop" as LanguageModelV1FinishReason, // Dify doesn't specify finish reason
      usage: {
        promptTokens: data.metadata?.usage?.prompt_tokens || 0,
        completionTokens: data.metadata?.usage?.completion_tokens || 0,
      },
      rawCall: this.createRawCall(options),
      providerMetadata: {
        difyWorkflowData: {
          conversationId: data.conversation_id as JSONValue,
          messageId: data.message_id as JSONValue,
        },
      },
      rawResponse: {
        headers: responseHeaders,
        body: data,
      },
      request: { body: JSON.stringify(requestBody) },
      response: {
        id: data.id,
        timestamp: new Date(),
      },
    };
  }

  async doStream(
    options: ExtendedLanguageModelV1CallOptions
  ): Promise<Awaited<ReturnType<LanguageModelV1["doStream"]>>> {
    const { abortSignal } = options;
    const requestBody = this.getRequestBody(options);
    const body = { ...requestBody, response_mode: "streaming" };

    const { responseHeaders, value: responseStream } = await postJsonToApi({
      url: this.chatMessagesEndpoint,
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: difyFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(
        difyStreamEventSchema
      ),
      abortSignal,
      fetch: this.config.fetch,
    });

    let conversationId: string | undefined;
    let messageId: string | undefined;
    let taskId: string | undefined;

    return {
      stream: responseStream.pipeThrough(
        new TransformStream<
          ParseResult<DifyStreamEvent>,
          LanguageModelV1StreamPart
        >({
          transform(chunk, controller) {
            if (!chunk.success) {
              controller.enqueue({ type: "error", error: chunk.error });
              return;
            }

            const data = chunk.value;

            // Store conversation/message IDs for metadata
            if (data.conversation_id) conversationId = data.conversation_id;
            if (data.message_id) messageId = data.message_id;
            if (data.task_id) taskId = data.task_id;

            // Handle known event types
            switch (data.event) {
              case "workflow_finished": {
                // Add block scope to prevent variable leakage
                let totalTokens = 0;

                // Type guard for data.data
                if (
                  "data" in data &&
                  data.data &&
                  typeof data.data === "object" &&
                  "total_tokens" in data.data &&
                  typeof data.data.total_tokens === "number"
                ) {
                  totalTokens = data.data.total_tokens;
                }

                controller.enqueue({
                  type: "finish",
                  finishReason: "stop",
                  providerMetadata: {
                    difyWorkflowData: {
                      conversationId: conversationId as JSONValue,
                      messageId: messageId as JSONValue,
                      taskId: taskId as JSONValue,
                    },
                  },
                  usage: {
                    promptTokens: 0,
                    completionTokens: totalTokens,
                  },
                });
                break;
              }

              case "message": {
                // Type guard for answer property
                if ("answer" in data && typeof data.answer === "string") {
                  controller.enqueue({
                    type: "text-delta",
                    textDelta: data.answer,
                  });

                  // Type guard for id property
                  if ("id" in data && typeof data.id === "string") {
                    controller.enqueue({
                      type: "response-metadata",
                      id: data.id,
                    });
                  }
                }
                break;
              }

              // Ignore other event types
            }
          },
        })
      ),
      rawCall: this.createRawCall(options),
      rawResponse: { headers: responseHeaders },
      request: { body: JSON.stringify(body) },
    };
  }

  /**
   * Get the request body for the Dify API
   */
  private getRequestBody(options: ExtendedLanguageModelV1CallOptions) {
    // In AI SDK v4, messages are in options.prompt instead of options.messages
    const messages = options.messages || options.prompt;

    if (!messages || !messages.length) {
      throw new APICallError({
        message: "No messages provided",
        url: this.chatMessagesEndpoint,
        requestBodyValues: options,
      });
    }

    const latestMessage = messages[messages.length - 1];

    if (latestMessage.role !== "user") {
      throw new APICallError({
        message: "The last message must be a user message",
        url: this.chatMessagesEndpoint,
        requestBodyValues: { latestMessageRole: latestMessage.role },
      });
    }

    // Handle file/image attachments
    const hasAttachments =
      Array.isArray(latestMessage.content) &&
      latestMessage.content.some((part: any) => {
        return typeof part !== "string" && part.type === "image";
      });

    if (hasAttachments) {
      throw new APICallError({
        message: "Dify provider does not currently support image attachments",
        url: this.chatMessagesEndpoint,
        requestBodyValues: { hasAttachments: true },
      });
    }

    // Extract the query from the latest user message
    let query = "";
    if (typeof latestMessage.content === "string") {
      query = latestMessage.content;
    } else if (Array.isArray(latestMessage.content)) {
      // Handle AI SDK v4 format with text objects in content array
      query = latestMessage.content
        .map((part: any) => {
          if (typeof part === "string") {
            return part;
          } else if (part.type === "text") {
            return part.text;
          }
          return "";
        })
        .filter(Boolean)
        .join(" ");
    }

    const conversationId = options.headers?.["chat-id"];
    const userId = options.headers?.["user-id"] ?? "you_should_pass_user-id";
    const {
      "chat-id": _,
      "user-id": __,
      ...cleanHeaders
    } = options.headers || {};
    options.headers = cleanHeaders;

    return {
      inputs: this.settings.inputs || {},
      query,
      response_mode: this.settings.responseMode,
      conversation_id: conversationId,
      user: userId,
    };
  }

  /**
   * Create the rawCall object for response
   */
  private createRawCall(options: ExtendedLanguageModelV1CallOptions) {
    return {
      rawPrompt: options.messages || options.prompt,
      rawSettings: { ...this.settings },
    };
  }

  supportsUrl?(url: URL): boolean {
    return false;
  }
}
