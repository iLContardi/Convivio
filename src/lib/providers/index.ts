import "server-only";

import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";
import { googleProvider } from "./google";
import type { Provider, ProviderId } from "./types";

export const providers: Record<ProviderId, Provider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  google: googleProvider,
};

export function getProvider(id: string): Provider {
  const p = providers[id as ProviderId];
  if (!p) throw new Error(`Provider sconosciuto: ${id}`);
  return p;
}

export * from "./types";
