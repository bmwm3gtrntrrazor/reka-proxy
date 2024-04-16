import { Response } from "express";
import fs from "node:fs";
import dotenv from "dotenv";

dotenv.config();

export const AUTH = process.env.AUTH;
if (!AUTH) throw new Error("No auth provided");

export const MODELS = [{ id: "reka-core", object: "model", created: 0, owned_by: "desu" }];

export const DUMMY_CHAT_COMPLETION_OBJECT = {
  id: "chatcmpl-desu",
  object: "chat.completion",
  created: 0,
  model: "reka-core",
  choices: [
    {
      index: 0,
      message: {
        role: "assistant",
        content: "desu",
      },
      logprobs: null,
      finish_reason: "stop",
    },
  ],
  usage: {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  },
};

const ROLES = ["user", "system", "assistant"];

export const ROLE_TO_TYPE = new Map([
  ["user", "human"],
  ["system", "human"],
  ["assistant", "model"],
]);

export function randomNumber() {
  return Math.floor(Math.random() * Math.pow(2, 32));
}

export function createChatCompletionObject(content: string, finishReason: string | null, isDelta = false) {
  if (isDelta) {
    return {
      ...DUMMY_CHAT_COMPLETION_OBJECT,
      choices: [
        {
          index: 0,
          delta: { role: "assistant", content },
          logprobs: null,
          finish_reason: finishReason,
        },
      ],
    };
  }

  return {
    ...DUMMY_CHAT_COMPLETION_OBJECT,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
  };
}

export function squashHumanMessages(messages: { text: string; type: string }[]) {
  const newArray = [];
  let previousType = "human";
  let previousText = "";

  for (const message of messages) {
    if (message.type !== previousType) {
      newArray.push({ type: previousType, text: previousText });
      previousText = "";
    }

    previousText += message.text;
    previousType = message.type;
  }

  if (previousText !== "") {
    newArray.push({ type: previousType, text: previousText });
  }

  return newArray;
}

export function isOpenAiMessage(message: unknown) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  if (!("role" in message) || typeof message.role !== "string" || !ROLES.includes(message.role)) return false;
  if (!("content" in message) || typeof message.content !== "string") return false;
  return true;
}

export function validateRekaMessage(message: unknown) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return false;
  if (!("text" in message) || typeof message.text !== "string") return false;
  if (!("metadata" in message) || !message.metadata || typeof message.metadata !== "object") return false;
  if (!("input_tokens" in message.metadata) || typeof message.metadata.input_tokens !== "number") return false;
  if (!("generated_tokens" in message.metadata) || typeof message.metadata.generated_tokens !== "number") return false;

  const content = message["text"];
  const promptTokens = message["metadata"]["input_tokens"];
  const completionTokens = message["metadata"]["generated_tokens"];

  const totalTokens = promptTokens + completionTokens;
  return { content, usage: { promptTokens, completionTokens, totalTokens } };
}

function convertOpenAiMessage(message: { content: string; role: string }) {
  if (!isOpenAiMessage(message)) return null;
  const role = ROLE_TO_TYPE.get(message.role);
  if (!role) return null;
  return { text: message.content, type: role };
}

export function convertOpenAiMessages(messages: unknown) {
  if (!Array.isArray(messages)) return null;
  if (messages.some((m) => !isOpenAiMessage(m))) return null;
  const newMessages: { text: string; type: string }[] = [];

  for (const message of messages) {
    const newMessage = convertOpenAiMessage(message);
    if (!newMessage) return null;
    newMessages.push(newMessage);
  }

  return newMessages;
}

export function respondWithError(response: Response, error: string, stream = false, headWritten = false) {
  if (!stream) {
    return response.json(createChatCompletionObject(error, "stop", false));
  }

  if (!headWritten) {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
  }

  const object = createChatCompletionObject(error, "stop", false);
  response.write(`data: ${JSON.stringify(object)}\n\n`);
  return response.end();
}
