import {
  APICallError,
  JSONValue,
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1FinishReason,
  LanguageModelV1ObjectGenerationMode,
  LanguageModelV1ProviderMetadata,
  LanguageModelV1StreamPart,
} from "@ai-sdk/provider";
import { generateId } from "@ai-sdk/provider-utils";
import { DifyChatModelId, DifyChatSettings } from "./dify-chat-settings";

interface ModelOptions {
  provider: string;
  baseURL: string;
  headers: () => Record<string, string>;
}

interface CompletionResponse {
  id: string;
  answer: string;
  task_id: string;
  conversation_id: string;
  message_id: string;
  metadata: {
    usage: {
      completion_tokens: number;
      prompt_tokens: number;
      total_tokens: number;
    };
  };
}

// For TypeScript compatibility
interface ExtendedLanguageModelV1CallOptions
  extends LanguageModelV1CallOptions {
  messages?: Array<{
    role: string;
    content: string | Array<string | { type: string; [key: string]: any }>;
  }>;
}

// Streaming response types for Dify workflow
interface DifyWorkflowData {
  id: string;
  workflow_id: string;
  sequence_number?: number;
  status?: string;
  outputs?: Record<string, any>;
  error?: any;
  elapsed_time?: number;
  total_tokens?: number;
  total_steps?: string | number;
  created_by?: {
    id: string;
    user: string;
  };
  created_at: number;
  finished_at?: number;
  exceptions_count?: number;
  files?: any[];
  inputs?: Record<string, any>;
}

// Base node data properties shared by all node types
interface DifyNodeDataBase {
  id: string;
  node_id: string;
  node_type: string;
  title: string;
  index: number;
  predecessor_node_id: string | null;
  created_at: number;
  finished_at?: number;
  status?: string;
  error?: any | null;
  elapsed_time?: number;
  extras?: Record<string, any>;
  files?: any[];
  parallel_id?: string | null;
  parallel_start_node_id?: string | null;
  parent_parallel_id?: string | null;
  parent_parallel_start_node_id?: string | null;
  iteration_id?: string | null;
  loop_id?: string | null;
  parallel_run_id?: string | null;
  agent_strategy?: string | null;
}

// Start node data
interface DifyStartNodeData extends DifyNodeDataBase {
  node_type: "start";
  inputs: Record<string, any> | null;
  outputs?: Record<string, any> | null;
  process_data?: null;
  execution_metadata?: null;
}

// LLM node data
interface DifyLLMNodeData extends DifyNodeDataBase {
  node_type: "llm";
  inputs: null;
  process_data?: {
    model_mode?: string;
    prompts?: Array<{
      role: string;
      text: string;
      files?: any[];
    }>;
    model_provider?: string;
    model_name?: string;
  };
  outputs?: {
    text?: string;
    usage?: {
      prompt_tokens: number;
      prompt_unit_price: string;
      prompt_price_unit: string;
      prompt_price: string;
      completion_tokens: number;
      completion_unit_price: string;
      completion_price_unit: string;
      completion_price: string;
      total_tokens: number;
      total_price: string;
      currency: string;
      latency: number;
    };
    finish_reason?: string;
  };
  execution_metadata?: {
    total_tokens: number;
    total_price: string;
    currency: string;
  };
}

// Answer node data
interface DifyAnswerNodeData extends DifyNodeDataBase {
  node_type: "answer";
  inputs: null;
  process_data?: null;
  outputs?: {
    answer: string;
    files: any[];
  };
  execution_metadata?: null;
}

// Union type of all node data types
type DifyNodeData = DifyStartNodeData | DifyLLMNodeData | DifyAnswerNodeData;

// Common properties for all event types
interface DifyEventBase {
  conversation_id?: string;
  message_id?: string;
  created_at?: number;
  task_id?: string;
}

// Workflow events
interface DifyWorkflowStartedEvent extends DifyEventBase {
  event: "workflow_started";
  workflow_run_id: string;
  data: DifyWorkflowData;
}

interface DifyWorkflowFinishedEvent extends DifyEventBase {
  event: "workflow_finished";
  workflow_run_id: string;
  data: DifyWorkflowData;
}

// Node events
interface DifyNodeStartedEvent extends DifyEventBase {
  event: "node_started";
  workflow_run_id: string;
  data: DifyNodeData;
}

interface DifyNodeFinishedEvent extends DifyEventBase {
  event: "node_finished";
  workflow_run_id: string;
  data: DifyNodeData;
}

// Message events
interface DifyMessageEvent extends DifyEventBase {
  event: "message";
  id?: string;
  answer: string;
  from_variable_selector?: string[];
}

interface DifyMessageEndEvent extends DifyEventBase {
  event: "message_end";
  id: string;
  metadata: {
    usage: {
      prompt_tokens: number;
      prompt_unit_price: string;
      prompt_price_unit: string;
      prompt_price: string;
      completion_tokens: number;
      completion_unit_price: string;
      completion_price_unit: string;
      completion_price: string;
      total_tokens: number;
      total_price: string;
      currency: string;
      latency: number;
    };
    retriever_resources?: Array<{
      position: number;
      dataset_id: string;
      dataset_name: string;
      document_id: string;
      document_name: string;
      segment_id: string;
      score: number;
      content: string;
    }>;
  };
  files?: any[];
}

// Text-to-speech events
interface DifyTTSMessageEvent extends DifyEventBase {
  event: "tts_message";
  audio: string;
}

interface DifyTTSMessageEndEvent extends DifyEventBase {
  event: "tts_message_end";
  audio: string;
}

// Union of all possible event types
type DifyStreamingResponse =
  | DifyWorkflowStartedEvent
  | DifyWorkflowFinishedEvent
  | DifyNodeStartedEvent
  | DifyNodeFinishedEvent
  | DifyMessageEvent
  | DifyMessageEndEvent
  | DifyTTSMessageEvent
  | DifyTTSMessageEndEvent;

export class DifyChatLanguageModel implements LanguageModelV1 {
  readonly specificationVersion = "v1";
  readonly provider: string;
  readonly modelId: string;
  readonly defaultObjectGenerationMode: LanguageModelV1ObjectGenerationMode =
    undefined;

  private readonly baseURL: string;
  private readonly headers: () => Record<string, string>;
  private readonly generateId: () => string;
  private readonly chatMessagesEndpoint: string;

  constructor(
    modelId: DifyChatModelId,
    private settings: DifyChatSettings = {},
    options: ModelOptions
  ) {
    this.modelId = modelId;
    this.provider = options.provider;
    this.baseURL = options.baseURL;
    this.headers = options.headers;
    this.generateId = generateId;
    this.chatMessagesEndpoint = `${this.baseURL}/chat-messages`;

    // Make sure we set a default response mode
    if (!this.settings.responseMode) {
      this.settings.responseMode = "streaming";
    }
  }

  async doGenerate(options: ExtendedLanguageModelV1CallOptions): Promise<{
    text?: string;
    toolCalls?: any[];
    finishReason: LanguageModelV1FinishReason;
    usage: {
      promptTokens: number;
      completionTokens: number;
    };
    rawCall: {
      rawPrompt: unknown;
      rawSettings: Record<string, unknown>;
    };
    providerMetadata?: LanguageModelV1ProviderMetadata;
  }> {
    const { abortSignal } = options;
    const requestBody = this.getRequestBody(options);
    const fetchOptions = this.createFetchOptions(
      requestBody,
      options.headers,
      abortSignal
    );

    const response = await fetch(this.chatMessagesEndpoint, fetchOptions);

    let responseData;
    try {
      const responseText = await response.text();

      if (!response.ok) {
        throw new APICallError({
          message: `Dify API returned ${response.status}: ${responseText}`,
          url: this.chatMessagesEndpoint,
          requestBodyValues: requestBody,
          statusCode: response.status,
          responseBody: responseText,
        });
      }

      responseData = JSON.parse(responseText) as CompletionResponse;
    } catch (error) {
      if (error instanceof APICallError) {
        throw error;
      }

      throw new APICallError({
        message: error instanceof Error ? error.message : "Unknown error",
        url: this.chatMessagesEndpoint,
        requestBodyValues: requestBody,
        cause: error,
      });
    }

    return {
      text: responseData.answer,
      toolCalls: [], // Dify doesn't currently support tool calls
      finishReason: "stop", // Dify doesn't specify finish reason
      usage: {
        promptTokens: responseData.metadata?.usage?.prompt_tokens || 0,
        completionTokens: responseData.metadata?.usage?.completion_tokens || 0,
      },
      rawCall: this.createRawCall(options),
      providerMetadata: {
        difyWorkflowData: {
          conversationId: responseData.conversation_id as JSONValue,
          messageId: responseData.message_id as JSONValue,
        },
      },
    };
  }

  async doStream(options: ExtendedLanguageModelV1CallOptions): Promise<{
    stream: ReadableStream<LanguageModelV1StreamPart>;
    rawCall: {
      rawPrompt: unknown;
      rawSettings: Record<string, unknown>;
    };
  }> {
    const { abortSignal } = options;
    const requestBody = this.getRequestBody(options);
    const fetchOptions = this.createFetchOptions(
      requestBody,
      options.headers,
      abortSignal
    );

    const response = await fetch(this.chatMessagesEndpoint, fetchOptions);

    if (!response.body) {
      throw new APICallError({
        message: "Response body is null",
        url: this.chatMessagesEndpoint,
        requestBodyValues: requestBody,
      });
    }

    return {
      stream: this.createStream(response.body),
      rawCall: this.createRawCall(options),
    };
  }

  private createStream(
    body: ReadableStream<Uint8Array>
  ): ReadableStream<LanguageModelV1StreamPart> {
    let buffer = ""; // Buffer to store incomplete chunks

    const textDecoder = new TextDecoder();

    return body.pipeThrough(
      new TransformStream<Uint8Array, LanguageModelV1StreamPart>({
        transform: async (chunk, controller) => {
          const text = textDecoder.decode(chunk);
          buffer += text; // Add new text to buffer

          // Process complete lines only
          const lines = buffer.split("\n");
          // Keep the last line in the buffer if it's incomplete
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.trim() === "") continue;

            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6)) as DifyStreamingResponse;

                if (data.event === "workflow_finished") {
                  // Type guard to make sure we have total_tokens
                  const workflowData = data as DifyWorkflowFinishedEvent;
                  controller.enqueue({
                    type: "finish",
                    finishReason: "stop",
                    providerMetadata: {
                      difyWorkflowData: {
                        conversationId: data.conversation_id as JSONValue,
                        messageId: data.message_id as JSONValue,
                        taskId: data.task_id as JSONValue,
                      },
                    },
                    usage: {
                      promptTokens: 0, // We don't have this in workflow_finished
                      completionTokens: workflowData.data?.total_tokens ?? 0,
                    },
                  });

                  return;
                }

                if (data.event === "message") {
                  const messageData = data as DifyMessageEvent;

                  controller.enqueue({
                    type: "text-delta",
                    textDelta: messageData.answer,
                  });

                  if (messageData.id) {
                    controller.enqueue({
                      type: "response-metadata",
                      id: messageData.id,
                    });
                  }
                }
              } catch (error) {
                console.error("Error parsing chunk:", line);
                // Don't send error to controller for parsing errors
                // This allows the stream to continue despite parse failures
              }
            }
          }
        },
      })
    );
  }

  /**
   * Create fetch options with merged headers
   */
  private createFetchOptions(
    requestBody: any,
    customHeaders?: Record<string, string | undefined> | undefined,
    abortSignal?: AbortSignal
  ) {
    return {
      method: "POST",
      headers: {
        ...this.headers(),
        ...(customHeaders || {}),
      } as HeadersInit,
      body: JSON.stringify(requestBody),
      signal: abortSignal,
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
    const userId = options.headers?.["user-id"];
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
