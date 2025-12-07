# Dify AI Provider for Vercel AI SDK

> **Note:** The current version only supports text messages.

A provider for [Dify.AI](https://dify.ai/) to work with [Vercel AI SDK](https://sdk.vercel.ai/).

This provider allows you to easily integrate Dify AI's application workflow with your applications using the Vercel AI SDK.

## Setting Up with Dify

To use this provider, you'll need:

- **Dify Account**: Create an account at [Dify.AI](https://dify.ai/)
- **Dify Application**: Each application functions as a model within the Vercel AI SDK
  - **Application ID**: Serves as the model ID in your code, can be found in the URL: `https://cloud.dify.ai/app/${dify-application-id}/workflow`
  - **API Key**: can be obtained from the application settings

## Installation

```bash
npm install dify-ai-provider

# pnpm
pnpm add dify-ai-provider

# yarn
yarn add dify-ai-provider
```

## Usage

### Basic Example

```typescript
import { generateText } from "ai";
import { difyProvider } from "dify-ai-provider";

process.env.DIFY_API_KEY = "dify-api-key"; // app-...

// Create a Dify provider instance
const dify = difyProvider("dify-application-id", {
  responseMode: "blocking",
});

// Generate text using Dify AI
const { text, providerMetadata } = await generateText({
  model: dify,
  messages: [{ role: "user", content: "Hello, how are you today?" }],
  headers: { "user-id": "test-user" },
});

const { conversationId, messageId } = providerMetadata.difyWorkflowData;
console.log(text);
console.log("conversationId", conversationId);
console.log("messageId", messageId);
```

### Continuing a Conversation

You can continue a conversation by providing a `chat-id` and `user-id` in request header:

```typescript
const { text: followUpText } = await generateText({
  model: dify,
  messages: [
    { role: "user", content: "That's great! What can you help me with?" },
  ],
  headers: { "user-id": "test-user", "chat-id": conversationId },
});

console.log("followUpText", followUpText);
```

### Streaming

```typescript
import { streamText } from "ai";
import { difyProvider } from "dify-ai-provider";

const dify = difyProvider("dify-application-id");

const stream = streamText({
  model: dify,
  messages: [{ role: "user", content: "Write a short poem about AI." }],
});

// Process text deltas as they arrive
for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}
```

### Use self-hosted dify

```typescript
import { createDifyProvider } from "dify-ai-provider";
const difyProvider = createDifyProvider({
  baseURL: "your-base-url",
});
const dify = difyProvider("dify-application-id", {
  responseMode: "blocking",
  apiKey: "dify-api-key",
});
```

### Use in Next.js AI Chatbot

[Next.js AI Chatbot](https://github.com/vercel/ai-chatbot) is a full-featured, hackable Next.js AI chatbot built by Vercel. If you want to use it as a chatbot frontend for a Dify application, follow the guidelines below:

#### Key Concepts

- In Dify, an **application** corresponds to a **model ID** in the AI provider
- A Dify **conversation** maps to a **chat session** in the chatbot
- When you first send a message to Dify, it automatically generates a new conversation
- You must save and reuse the conversation ID for subsequent messages to maintain chat continuity
- Without reusing the conversation ID, each message will create a new conversation in Dify

#### Getting the Conversation ID

You can retrieve the Dify conversation ID from the `onFinish` callback:

```ts
onFinish: async ({ response, providerMetadata }) => {
  const conversationId = providerMetadata?.difyWorkflowData?.conversationId as string;
  const messageId = providerMetadata?.difyWorkflowData?.messageId as string;
  // Save conversationId for future use
}
```

#### Passing Headers for Conversation Continuity

Pass the user ID and conversation ID in the headers when calling `streamText`:

> **Important:** The `conversation_id` must be obtained from a Dify response. Using an invalid conversation ID will result in an error stating that the conversation does not exist.

```ts
const stream = createDataStream({
  execute: (dataStream) => {
    const headers = {
      'user-id': session.user.id,
      'chat-id': conversation_id_returned_from_dify
    };

    const result = streamText({
      model: myProvider.languageModel(selectedChatModel),
      headers,
      // ... other options
    });

    // ... rest of implementation
  }
  // ... other options
});
```

## API Reference

### `difyProvider(modelId, settings?)`

Creates a Dify chat model instance.

#### Parameters

- ProviderSettings

  - `modelId` (string): The ID of your Dify application.
  - `settings` (optional object):
    - `baseURL` (string): The base URL for the Dify API. Default is `https://api.dify.ai/v1`.
    - `headers` (Record<string, string>): The headers that will be set to dify api

- ChatSettings

  - `inputs` (object): Additional inputs to send with the request.
  - `responseMode` (string): Response mode, defaults to `"streaming"`.
  - `apiKey` (string): Your Dify application API key. If not provided, it will use the `DIFY_API_KEY` environment variable.

## Documentation

- [Vercel AI SDK documentation](https://sdk.vercel.ai/docs/introduction)
- [Dify API documentation](https://docs.dify.ai/en/use-dify/publish/developing-with-apis)
