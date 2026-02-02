// Define model IDs for Dify
export type DifyChatModelId = string;

export interface Logger {
  debug: (message: string, extra?: Record<string, any>) => void;
  info: (message: string, extra?: Record<string, any>) => void;
  warn: (message: string, extra?: Record<string, any>) => void;
  error: (message: string, extra?: Record<string, any>) => void;
}

export const defaultLogger: Logger = {
  debug: (message, extra) => console.debug(`[dify-ai-provider] ${message}`, extra ?? ""),
  info: (message, extra) => console.log(`[dify-ai-provider] ${message}`, extra ?? ""),
  warn: (message, extra) => console.warn(`[dify-ai-provider] ${message}`, extra ?? ""),
  error: (message, extra) => console.error(`[dify-ai-provider] ${message}`, extra ?? ""),
};

export interface DifyChatSettings {
  /**
   * Additional inputs to send with the request.
   * This corresponds to the 'inputs' field in Dify's API.
   */
  inputs?: Record<string, any>;

  /**
   * Response mode, defaults to "streaming".
   */
  responseMode?: "streaming" | "blocking";

  /**
   * API key.
   */
  apiKey?: string;

  /**
   * Logger instance for debugging. If not provided, uses default console logger at info level.
   * Set to `false` to disable logging.
   */
  logger?: Logger | false;

  /**
   * Inject tool definitions into the query prompt for LLMs that don't natively support tool calling.
   * Defaults to `true` (appended to query). Set to `false` to disable.
   */
  injectToolsPrompt?: boolean;

  /**
   * Log request and response messages. Defaults to `false`.
   */
  logMessages?: boolean;

}
