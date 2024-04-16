import express, { Request, Response } from "express";
import {
  AUTH,
  MODELS,
  PORT,
  convertOpenAiMessages,
  createChatCompletionObject,
  respondWithError,
  squashHumanMessages,
} from "./utils";
import { generateMessage } from "./reka";
import async from "async";

const app = express();

type Task = {
  request: Request;
  response: Response;
  stream: boolean;
  messages: {
    type: string;
    text: string;
  }[];
};

let TOTAL_TOKEN_USAGE = 0;
let TOTAL_PROMPT_TOKENS = 0;
let TOTAL_COMPLETION_TOKENS = 0;
let TOTAL_PROOMPTS = 0;
let STARTED_AT = new Date().getTime();

const ipMap = new Map();
const queue = async.queue((task: Task, callback) => {
  const { request, response, messages, stream } = task;
  console.log(`Handling request of ${request.ip}`);

  return generateMessage({
    auth: AUTH as string,
    messages,
    stream,
    onToken: (token) => {
      if (!stream) return;
      const data = createChatCompletionObject(token, null, true);
      return response.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    onEnd: (content, error, usage) => {
      const finalContent = content ?? `Unexpected error during generation: \`\`\`${error}\`\`\``;

      if (!stream) {
        response.json(createChatCompletionObject(finalContent, "stop", false));
        callback();
        return;
      }

      if (usage) {
        TOTAL_TOKEN_USAGE += usage.totalTokens;
        TOTAL_COMPLETION_TOKENS += usage.completionTokens;
        TOTAL_PROMPT_TOKENS += usage.promptTokens;
        TOTAL_PROOMPTS += 1;
      }

      const data = createChatCompletionObject(finalContent, "stop", true);
      response.write(`data: ${JSON.stringify(data)}\n\n`);
      response.end();

      console.log(`Request of ${request.ip} has finished.`);
      ipMap.delete(request.ip);
      callback();
    },
  }).catch((error) => {
    console.log("queue error " + error);
    ipMap.delete(request.ip);
    callback(error);
  });
}, 5);

app.use(express.json());

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/plain").send(
    `
# Stats
  - Uptime: ${Math.round((new Date().getTime() - STARTED_AT) / 1000)}
  - Total Token Usage: ${TOTAL_TOKEN_USAGE}
  - Total Completion Tokens: ${TOTAL_COMPLETION_TOKENS}
  - Total Prompt Tokens: ${TOTAL_PROMPT_TOKENS}
  - Total Proompts: ${TOTAL_PROOMPTS}
  - Proompters in Queue: ${queue.length()}
  `.trim()
  );
});

app.get("/reka/v1/models", (req, res) => {
  return res.json({
    object: "list",
    data: MODELS,
  });
});

app.post("/reka/v1/chat/completions", (req, res) => {
  if (!req.ip) return res.status(400);

  if (ipMap.has(req.ip)) {
    return res.status(429).json({ message: "Too many requests. Please wait for the previous request to complete." });
  }
  const stream = req.body.stream ?? false;

  const converted = convertOpenAiMessages(req.body.messages);
  if (!converted) return respondWithError(res, "Failed to convert the messages.", stream);
  const squashed = squashHumanMessages(converted);

  if (stream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
  }

  console.log("New ip added to the queue " + req.ip);
  queue.push({
    request: req,
    response: res,
    messages: squashed,
    stream: stream,
  });
  ipMap.set(req.ip, true);
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
