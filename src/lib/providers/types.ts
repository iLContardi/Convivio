/**
 * Interfaccia comune ai tre provider.
 *
 * Volutamente sottile: normalizza solo ciò che il motore di turnazione deve
 * sapere (elenco modelli, streaming di testo, token consumati). I parametri di
 * generazione NON sono normalizzati, perché non sono più equivalenti fra
 * famiglie — vedi `ModelCapabilities`.
 */

export type ProviderId = "anthropic" | "openai" | "google";

export const PROVIDER_IDS: ProviderId[] = ["anthropic", "openai", "google"];

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelCapabilities {
  /** Alcune famiglie hanno rimosso la temperatura: mandarla è un errore 400. */
  temperature: boolean;
  /** Livelli di "quanto ragionare" accettati, oppure null se il concetto non esiste. */
  effort: EffortLevel[] | null;
  /** Il modello può ragionare prima di rispondere (e quel ragionamento consuma output). */
  thinking: boolean;
  maxOutputTokens: number | null;
}

export interface ModelInfo {
  id: string;
  label: string;
  capabilities: ModelCapabilities;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Parametri per-ospite, salvati come JSON in `guests.params`. */
export interface GuestParams {
  temperature?: number;
  effort?: EffortLevel;
}

export interface GenerateRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  params: GuestParams;
  /** Identità stabile della coppia (conversazione, ospite), per il routing di cache. */
  cacheKey?: string;
  signal?: AbortSignal;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  /** Token letti dalla cache: si pagano un decimo. Zero se la cache non ha preso. */
  cachedTokens: number;
  cacheWriteTokens: number;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "done"; usage: Usage; model: string };

export interface Provider {
  id: ProviderId;
  /** Nome pubblico proposto quando si crea l'ospite. */
  defaultGuestName: string;
  /** Nome della variabile d'ambiente che contiene la chiave. */
  envVar: string;
  /** Elenco letto dall'API del provider, non da una lista scritta a mano. */
  listModels(): Promise<ModelInfo[]>;
  stream(req: GenerateRequest): AsyncGenerator<StreamEvent>;
}

export class MissingKeyError extends Error {
  constructor(envVar: string) {
    super(`Chiave assente: imposta ${envVar} in .env.local`);
    this.name = "MissingKeyError";
  }
}

export function requireKey(envVar: string): string {
  const key = process.env[envVar];
  if (!key) throw new MissingKeyError(envVar);
  return key;
}
