// Define model IDs for Dify
export type DifyChatModelId = string;

/**
 * Settings for the Dify chat API.
 */
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
}
