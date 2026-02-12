/**
 * Debug script: calls provider doStream() or doGenerate() and prints every part.
 *
 * Usage:
 *   DIFY_BASE_URL=https://api.dify.ai/v1 DIFY_API_KEY=app-xxx npx tsx test/debug-stream.ts <appId> [options]
 *
 * Options:
 *   --user <id>          User ID (default: debug-user)
 *   --query <text>       Query text (default: "Introduce yourself")
 *   --chat-id <id>       Conversation ID for multi-turn
 *   --blocking           Use doGenerate (blocking mode) instead of streaming
 */
import { DifyChatLanguageModel } from "../src/dify-chat-language-model";
import { loadApiKey } from "@ai-sdk/provider-utils";

function parseArgs() {
  const args = process.argv.slice(2);
  let appId = "";
  let user = "debug-user";
  let query = "Introduce yourself";
  let chatId = "";
  let blocking = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--blocking") blocking = true;
    else if (args[i] === "--user" && i + 1 < args.length) user = args[++i];
    else if (args[i] === "--query" && i + 1 < args.length) query = args[++i];
    else if (args[i] === "--chat-id" && i + 1 < args.length) chatId = args[++i];
    else if (!args[i].startsWith("--")) appId = args[i];
  }
  return { appId: appId || "default", user, query, chatId, blocking };
}

const { appId, user: userId, query, chatId, blocking } = parseArgs();

const logger = {
  debug: (msg: string, extra?: any) => console.debug(`[DEBUG] ${msg}`, extra ?? ""),
  info:  (msg: string, extra?: any) => console.log(`[INFO]  ${msg}`, extra ?? ""),
  warn:  (msg: string, extra?: any) => console.warn(`[WARN]  ${msg}`, extra ?? ""),
  error: (msg: string, extra?: any) => console.error(`[ERROR] ${msg}`, extra ?? ""),
};

const baseURL = process.env.DIFY_BASE_URL || "https://api.dify.ai/v1";
const logMessages = true;

const model = new DifyChatLanguageModel(
  appId,
  {responseMode: blocking ? "blocking" : "streaming", logger, logMessages},
  {
    provider: "dify.chat",
    baseURL,
    headers: () => ({
      Authorization: `Bearer ${loadApiKey({ apiKey: undefined, environmentVariableName: "DIFY_API_KEY", description: "Dify API Key" })}`,
      "Content-Type": "application/json",
    }),
  }
);

const callOptions: any = {
  prompt: [{ role: "user", content: [{ type: "text", text: query }] }],
  headers: {
    "user-id": userId,
    ...(chatId ? { "chat-id": chatId } : {}),
  },
  inputFormat: "messages",
  mode: { type: "regular" },
};

(async () => {
  try {
    if (blocking) {
      console.log(`=== doGenerate (blocking) === query: "${query}"\n`);
      const result = await model.doGenerate(callOptions);
      console.log("content:", JSON.stringify(result.content, null, 2));
      console.log("finishReason:", result.finishReason);
      console.log("usage:", result.usage);
      console.log("providerMetadata:", JSON.stringify(result.providerMetadata, null, 2));
    } else {
      console.log(`=== doStream === query: "${query}"\n`);
      const { stream } = await model.doStream(callOptions);
      const reader = stream.getReader();
      let idx = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        console.log(`[${idx++}]`, JSON.stringify(value));
      }
    }
    console.log("\n=== Done ===");
  } catch (e) {
    console.error("Failed:", e);
    process.exit(1);
  }
})();
