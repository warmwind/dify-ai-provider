import {
  APICallError,
  type JSONValue,
  type LanguageModelV2,
  type LanguageModelV2CallOptions,
  type LanguageModelV2Content,
  type LanguageModelV2FinishReason,
  type LanguageModelV2StreamPart,
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
import type { DifyChatModelId, DifyChatSettings } from "./dify-chat-settings";
import {
  completionResponseSchema,
  difyStreamEventSchema,
  errorResponseSchema,
} from "./dify-chat-schema";
import type { DifyStreamEvent } from "./dify-chat-schema";
import type { z } from "zod";

type CompletionResponse = z.infer<typeof completionResponseSchema>;
type ErrorResponse = z.infer<typeof errorResponseSchema>;

interface ModelConfig {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
  fetch?: FetchFunction;
}

const difyFailedResponseHandler = createJsonErrorResponseHandler({
  errorSchema: errorResponseSchema as any,
  errorToMessage: (data: ErrorResponse) => {
    console.log("Dify API error:", data);
    return `Dify API error: ${data.message}`;
  },
});

export class DifyChatLanguageModel implements LanguageModelV2 {
  readonly specificationVersion = "v2" as const;
  readonly modelId: string;
  readonly supportedUrls: Record<string, RegExp[]> = {};

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
    options: LanguageModelV2CallOptions
  ): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
    const { abortSignal } = options;
    const requestBody = this.getRequestBody(options);

    const { responseHeaders, value: data } = await postJsonToApi({
      url: this.chatMessagesEndpoint,
      headers: combineHeaders(this.config.headers(), options.headers),
      body: requestBody,
      abortSignal,
      failedResponseHandler: difyFailedResponseHandler,
      successfulResponseHandler: createJsonResponseHandler(
        completionResponseSchema as any
      ),
      fetch: this.config.fetch,
    });

    const typedData = data as CompletionResponse;
    const content: LanguageModelV2Content[] = [];

    // Add text content if available
    if (typedData.answer) {
      content.push({
        type: "text",
        text: typedData.answer,
      });
    }

    return {
      content,
      finishReason: "stop" as LanguageModelV2FinishReason,
      usage: {
        inputTokens: typedData.metadata.usage.prompt_tokens,
        outputTokens: typedData.metadata.usage.completion_tokens,
        totalTokens: typedData.metadata.usage.total_tokens,
      },
      warnings: [],
      providerMetadata: {
        difyWorkflowData: {
          conversationId: typedData.conversation_id as JSONValue,
          messageId: typedData.message_id as JSONValue,
        },
      },
      request: { body: JSON.stringify(requestBody) },
      response: {
        id: typedData.id,
        timestamp: new Date(),
        headers: responseHeaders,
      },
    };
  }

  async doStream(
    options: LanguageModelV2CallOptions
  ): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
    const { abortSignal } = options;
    const requestBody = this.getRequestBody(options);
    const body = { ...requestBody, response_mode: "streaming" };

    const { responseHeaders, value: responseStream } = await postJsonToApi({
      url: this.chatMessagesEndpoint,
      headers: combineHeaders(this.config.headers(), options.headers),
      body,
      failedResponseHandler: difyFailedResponseHandler,
      successfulResponseHandler: createEventSourceResponseHandler(
        difyStreamEventSchema as any
      ),
      abortSignal,
      fetch: this.config.fetch,
    });

    let conversationId: string | undefined;
    let messageId: string | undefined;
    let taskId: string | undefined;
    let isActiveText = false;

    return {
      stream: responseStream.pipeThrough(
        new TransformStream<
          ParseResult<DifyStreamEvent>,
          LanguageModelV2StreamPart
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
              case "workflow_finished":
              case "message_end": {
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
                if (isActiveText) {
                  controller.enqueue({
                    type: "text-end",
                    id: "0",
                  });
                  isActiveText = false;
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
                    inputTokens: 0,
                    outputTokens: totalTokens,
                    totalTokens: totalTokens,
                  },
                });
                break;
              }

              case "message":
              case "agent_message": {
                // Type guard for answer property
                if ("answer" in data && typeof data.answer === "string") {
                  if (!isActiveText) {
                    isActiveText = true;
                    controller.enqueue({
                      type: "text-start",
                      id: "0",
                    });
                  }

                  controller.enqueue({
                    type: "text-delta",
                    id: "0",
                    delta: data.answer,
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
      request: { body: JSON.stringify(body) },
      response: { headers: responseHeaders },
    };
  }

  /**
   * Get the request body for the Dify API
   */
  private getRequestBody(options: LanguageModelV2CallOptions) {
    // In AI SDK v5 LanguageModelV2, messages are in options.prompt
    const messages = options.prompt || (options as any).messages;

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
      latestMessage.content.some((part) => {
        return (
          typeof part !== "string" &&
          part !== null &&
          typeof part === "object" &&
          "type" in part &&
          part.type === "file"
        );
      });

    if (hasAttachments) {
      throw new APICallError({
        message: "Dify provider does not currently support file attachments",
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
        .map((part) => {
          if (typeof part === "string") {
            return part;
          } else if (
            typeof part === "object" &&
            part !== null &&
            "type" in part &&
            part.type === "text" &&
            "text" in part
          ) {
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
}
