import "server-only";

import OpenAI from "openai";
import type {
  EffortLevel,
  GenerateRequest,
  ModelInfo,
  Provider,
  StreamEvent,
} from "./types";
import { requireKey } from "./types";

const ENV_VAR = "OPENAI_API_KEY";

/** Modelli che ragionano prima di rispondere: niente temperatura, sì effort. */
const REASONING = /^(o\d|gpt-5)/;

/** Modelli non conversazionali (audio, immagini, embedding…) da non proporre. */
const NOT_CHAT =
  /(audio|realtime|transcribe|tts|image|dall-e|whisper|embedding|moderation|instruct)/;

function client(): OpenAI {
  requireKey(ENV_VAR);
  return new OpenAI();
}

export const openaiProvider: Provider = {
  id: "openai",
  defaultGuestName: "GPT",
  envVar: ENV_VAR,

  async listModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];

    for await (const m of client().models.list()) {
      if (!/^(gpt|o\d|chatgpt)/.test(m.id)) continue;
      if (NOT_CHAT.test(m.id)) continue;

      const reasoning = REASONING.test(m.id);
      models.push({
        id: m.id,
        label: m.id,
        capabilities: {
          temperature: !reasoning,
          // OpenAI espone tre livelli, non i cinque di Anthropic.
          effort: reasoning ? ["low", "medium", "high"] : null,
          thinking: reasoning,
          maxOutputTokens: null,
        },
      });
    }

    // L'elenco è lungo e senza date coerenti: le famiglie recenti vanno in
    // cima, altrimenti la serie `o` seppellisce i GPT-5 nel menu.
    const rank = (id: string) =>
      /^gpt-5/.test(id) ? 0 : /^o\d/.test(id) ? 1 : /^gpt-4/.test(id) ? 2 : 3;

    return models.sort(
      (a, b) => rank(a.id) - rank(b.id) || b.id.localeCompare(a.id),
    );
  },

  async *stream(req: GenerateRequest): AsyncGenerator<StreamEvent> {
    const reasoning = REASONING.test(req.model);

    const body: Record<string, unknown> = {
      model: req.model,
      max_completion_tokens: req.maxTokens,
      messages: [
        { role: "system", content: req.system },
        ...req.messages,
      ],
      stream: true,
      // Senza questo l'ultimo chunk non porta i token consumati.
      stream_options: { include_usage: true },
    };

    // Il caching qui è automatico e mette da sé un punto sull'ultimo messaggio
    // utente — cioè dove la trascrizione cresce. Serve solo dare un'identità
    // stabile alla coppia (conversazione, ospite) per il routing verso la macchina
    // che ha già il prefisso.
    if (req.cacheKey) body.prompt_cache_key = req.cacheKey;

    if (reasoning && req.params.effort) {
      // I nostri cinque livelli si comprimono nei tre di OpenAI.
      const map: Record<EffortLevel, "low" | "medium" | "high"> = {
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "high",
        max: "high",
      };
      body.reasoning_effort = map[req.params.effort];
    }
    if (!reasoning && req.params.temperature !== undefined) {
      body.temperature = req.params.temperature;
    }

    const stream = await client().chat.completions.create(
      body as unknown as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal: req.signal },
    );

    let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 };
    let model = req.model;

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content;
      if (text) yield { type: "text", text };
      if (chunk.model) model = chunk.model;
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          cachedTokens:
            chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
          cacheWriteTokens: 0,
        };
      }
    }

    yield { type: "done", usage, model };
  },
};
