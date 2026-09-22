import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import type {
  EffortLevel,
  GenerateRequest,
  ModelInfo,
  Provider,
  StreamEvent,
} from "./types";
import { requireKey } from "./types";

const ENV_VAR = "ANTHROPIC_API_KEY";
const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

/** Forma delle capability restituite da /v1/models, che l'SDK non tipizza. */
type RawCapabilities = {
  effort?: { supported?: boolean } & Partial<
    Record<EffortLevel, { supported?: boolean }>
  >;
  thinking?: { supported?: boolean };
};

function client(): Anthropic {
  requireKey(ENV_VAR);
  return new Anthropic();
}

export const anthropicProvider: Provider = {
  id: "anthropic",
  defaultGuestName: "Claude",
  envVar: ENV_VAR,

  async listModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];

    for await (const m of client().models.list()) {
      const caps = (m as unknown as { capabilities?: RawCapabilities })
        .capabilities;

      const effort = caps?.effort?.supported
        ? EFFORT_LEVELS.filter((l) => caps.effort?.[l]?.supported)
        : null;

      models.push({
        id: m.id,
        label: m.display_name ?? m.id,
        capabilities: {
          // Le famiglie che espongono `effort` hanno rimosso i parametri di
          // campionamento: mandare `temperature` a queste è un 400, non
          // un parametro ignorato.
          temperature: !effort,
          effort,
          thinking: caps?.thinking?.supported ?? false,
          maxOutputTokens:
            (m as unknown as { max_tokens?: number }).max_tokens ?? null,
        },
      });
    }

    return models;
  },

  async *stream(req: GenerateRequest): AsyncGenerator<StreamEvent> {
    // Due punti di cache sui quattro disponibili, con frequenze di cambio
    // diverse: il prefisso di sistema è congelato per tutta la conversazione, la
    // trascrizione cresce in coda. Senza il secondo, ogni turno ripaga a
    // prezzo pieno tutta la conversazione accumulata — è lì che sta il costo.
    //
    // TTL di un'ora invece dei 5 minuti di default: con tre ospiti e il
    // ragionamento attivo, fra due turni dello stesso ospite passano spesso
    // più di cinque minuti. Il raddoppio si paga solo sul delta scritto a
    // ogni turno, non sul prefisso già in cache.
    const cache = { type: "ephemeral", ttl: "1h" } as const;

    const messages = req.messages.map((m, i) =>
      i === req.messages.length - 1
        ? {
            role: m.role,
            content: [{ type: "text", text: m.content, cache_control: cache }],
          }
        : m,
    );

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens,
      system: [{ type: "text", text: req.system, cache_control: cache }],
      messages,
    };

    if (req.params.effort) {
      body.output_config = { effort: req.params.effort };
    }
    if (req.params.temperature !== undefined) {
      body.temperature = req.params.temperature;
    }

    const stream = client().messages.stream(
      body as Parameters<Anthropic["messages"]["stream"]>[0],
      { signal: req.signal },
    );

    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { type: "text", text: event.delta.text };
      }
    }

    const final = await stream.finalMessage();
    yield {
      type: "done",
      model: final.model,
      usage: {
        // `input_tokens` conta solo ciò che NON era in cache: i tre valori
        // sono disgiunti e vanno sommati per avere il prompt totale.
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        cachedTokens: final.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: final.usage.cache_creation_input_tokens ?? 0,
      },
    };
  },
};
