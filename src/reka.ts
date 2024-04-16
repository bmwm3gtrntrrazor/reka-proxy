import { MODELS, randomNumber, validateRekaMessage } from "./utils";

type OpenAiUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type GenerateOptions = {
  auth: string;
  messages: { type: string; text: string }[];
  model?: string;
  stream?: boolean;
  seed?: number;
  onToken?: (token: string) => void;
  onEnd?: (content?: string, error?: string, usage?: OpenAiUsage) => void;
};

export function generateMessage(options: GenerateOptions) {
  const model = options.model ?? "reka-core";
  const stream = options.stream ?? false;
  const seed = options.seed ?? randomNumber();

  if (!MODELS.some((m) => m.id === model)) throw new Error("Invalid model.");

  return new Promise<void>((resolve, _) => {
    const response = fetch("https://chat.reka.ai/api/chat", {
      headers: {
        authorization: `Bearer ${options.auth}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        conversation_history: options.messages,
        stream: stream,
        use_search_engine: false,
        use_code_interpreter: false,
        model_name: model,
        random_seed: seed,
      }),
      method: "POST",
    });

    if (!stream) {
      response.then((response) => {
        if (!response.ok) {
          response.text().then((text) => {
            options.onEnd?.(undefined, `Reka error: ${response.statusText} | ${text}`);
            return resolve();
          });
        }

        response.json().then((json) => {
          const message = validateRekaMessage(json);

          if (!message) {
            options.onEnd?.(undefined, "Reka message couldnt be validated.");
            return resolve();
          }

          options.onEnd?.(message.content, undefined, message.usage);
          return resolve();
        });
      });
    } else {
      response.then((response) => {
        if (!response.ok) {
          response.text().then((text) => {
            options.onEnd?.(undefined, `Reka error: ${response.statusText} | ${text}`);
            return resolve();
          });
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder("utf-8");
        let content = "";

        function readEvents() {
          reader?.read().then(({ value, done }) => {
            const text = decoder.decode(value);
            const events = text.trim().split("\n\n");

            events.forEach((event) => {
              if (!event.startsWith("event: message")) return;
              // regex probably would be better
              const data = event.split("\n")[1].replace("data: ", "");
              const json = JSON.parse(data);

              const delta = json["text"].replace(content, "");
              content = json["text"];

              if (delta.length < 50) options.onToken?.(delta);

              if (json["finish_reason"]) {
                const message = validateRekaMessage(json);
                if (!message) return;
                options.onEnd?.("", undefined, message.usage);
                return resolve();
              }
            });

            if (!done) readEvents();
          });
        }

        readEvents();
      });
    }
  });
}
