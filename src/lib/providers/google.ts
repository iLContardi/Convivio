import "server-only";

import { GoogleGenAI } from "@google/genai";
import type {
  GenerateRequest,
  ModelInfo,
  Provider,
  StreamEvent,
} from "./types";
import { requireKey } from "./types";

const ENV_VAR = "GOOGLE_API_KEY";

/** Varianti non conversazionali dell'elenco Gemini. */
const NOT_CHAT =
  /(image|tts|audio|embedding|robotics|computer-use|aqa|learnlm|nano)/i;

function client(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: requireKey(ENV_VAR) });
}

/** Gemini chiama "model" il ruolo che gli altri due chiamano "assistant". */
function toContents(messages: GenerateRequest["messages"]) {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

export const googleProvider: Provider = {
  id: "google",
  defaultGuestName: "Gemini",
  envVar: ENV_VAR,

  async listModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];

    for await (const m of await client().models.list()) {
      const name = m.name ?? "";
      if (!name.includes("gemini")) continue;
      if (NOT_CHAT.test(name)) continue;
      if (!(m.supportedActions ?? []).includes("generateContent")) continue;

      models.push({
        // L'API restituisce "models/gemini-…", ma accetta l'id nudo.
        id: name.replace(/^models\//, ""),
        label: m.displayName ?? name,
        capabilities: {
          temperature: true,
          // Gemini governa il ragionamento con `thinkingConfig`, che non è
          // sovrapponibile a `effort`: non lo esponiamo finché non serve.
          effort: null,
          thinking: true,
          maxOutputTokens: m.outputTokenLimit ?? null,
        },
      });
    }

    return models.sort((a, b) => a.id.localeCompare(b.id));
  },

  async *stream(req: GenerateRequest): AsyncGenerator<StreamEvent> {
    const config: Record<string, unknown> = {
      systemInstruction: req.system,
      maxOutputTokens: req.maxTokens,
      abortSignal: req.signal,
    };
    if (req.params.temperature !== undefined) {
      config.temperature = req.params.temperature;
    }

    const stream = await client().models.generateContentStream({
      model: req.model,
      contents: toContents(req.messages),
      config,
    });

    let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 };

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield { type: "text", text };

      const meta = chunk.usageMetadata;
      if (meta) {
        usage = {
          inputTokens: meta.promptTokenCount ?? usage.inputTokens,
          // Il ragionamento è fatturato come output ma contato a parte.
          outputTokens:
            (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0) ||
            usage.outputTokens,
          // Qui il caching è implicito e non dichiarabile: misurarlo è l'unico
          // controllo che abbiamo per accorgerci che ha smesso di prendere.
          cachedTokens: meta.cachedContentTokenCount ?? usage.cachedTokens,
          cacheWriteTokens: 0,
        };
      }
    }

    yield { type: "done", usage, model: req.model };
  },
};
