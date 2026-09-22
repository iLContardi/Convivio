import "server-only";

import { nanoid } from "nanoid";
import { getDb, nowIso } from "./index";
import type { GuestParams, ProviderId } from "@/lib/providers/types";
import { PROVIDER_IDS } from "@/lib/providers/types";

export interface Guest {
  id: string;
  name: string;
  provider: ProviderId;
  model: string;
  keyRef: string;
  persona: string;
  targetWords: number;
  maxTokens: number;
  params: GuestParams;
  color: string;
  emoji: string;
  archived: boolean;
  createdAt: string;
}

interface GuestRow {
  id: string;
  name: string;
  provider: string;
  model: string;
  key_ref: string;
  persona: string | null;
  target_words: number;
  max_tokens: number;
  params: string;
  color: string;
  emoji: string;
  archived: number;
  created_at: string;
}

function toGuest(row: GuestRow): Guest {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider as ProviderId,
    model: row.model,
    keyRef: row.key_ref,
    persona: row.persona ?? "",
    targetWords: row.target_words,
    maxTokens: row.max_tokens,
    params: JSON.parse(row.params) as GuestParams,
    color: row.color,
    emoji: row.emoji,
    archived: row.archived === 1,
    createdAt: row.created_at,
  };
}

/**
 * Un ospite per famiglia: alla prima apertura le tre schede esistono già.
 * Il modello di GPT resta vuoto di proposito — le varianti 5.6 sono tre e la
 * scelta è dell'utente, non nostra.
 */
const SEED: Record<ProviderId, Omit<Guest, "id" | "createdAt" | "archived">> = {
  anthropic: {
    name: "Claude",
    provider: "anthropic",
    model: "claude-opus-5",
    keyRef: "ANTHROPIC_API_KEY",
    persona: "",
    targetWords: 200,
    maxTokens: 4000,
    params: { effort: "medium" },
    color: "#C96442",
    emoji: "✳️",
  },
  openai: {
    name: "GPT",
    provider: "openai",
    model: "",
    keyRef: "OPENAI_API_KEY",
    persona: "",
    targetWords: 200,
    maxTokens: 4000,
    params: { effort: "medium" },
    color: "#10A37F",
    emoji: "⬢",
  },
  google: {
    name: "Gemini",
    provider: "google",
    model: "gemini-3.1-pro-preview",
    keyRef: "GOOGLE_API_KEY",
    persona: "",
    targetWords: 200,
    maxTokens: 4000,
    params: { temperature: 1 },
    color: "#4285F4",
    emoji: "✦",
  },
};

export function listGuests(): Guest[] {
  const db = getDb();
  seedIfEmpty();
  const rows = db
    .prepare("SELECT * FROM guests ORDER BY created_at ASC")
    .all() as GuestRow[];
  return rows.map(toGuest);
}

export function getGuestById(id: string): Guest | null {
  const row = getDb()
    .prepare("SELECT * FROM guests WHERE id = ?")
    .get(id) as GuestRow | undefined;
  return row ? toGuest(row) : null;
}

export function getGuest(provider: ProviderId): Guest | null {
  const row = getDb()
    .prepare("SELECT * FROM guests WHERE provider = ?")
    .get(provider) as GuestRow | undefined;
  return row ? toGuest(row) : null;
}

export function updateGuest(
  provider: ProviderId,
  patch: Partial<Omit<Guest, "id" | "provider" | "createdAt">>,
): Guest {
  const current = getGuest(provider);
  if (!current) throw new Error(`Ospite inesistente: ${provider}`);

  const next = { ...current, ...patch };
  getDb()
    .prepare(
      `UPDATE guests SET name = ?, model = ?, persona = ?, target_words = ?,
         max_tokens = ?, params = ?, color = ?, emoji = ?, archived = ?
       WHERE provider = ?`,
    )
    .run(
      next.name,
      next.model,
      next.persona,
      next.targetWords,
      next.maxTokens,
      JSON.stringify(next.params),
      next.color,
      next.emoji,
      next.archived ? 1 : 0,
      provider,
    );

  return getGuest(provider)!;
}

function seedIfEmpty(): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO guests
       (id, name, provider, model, key_ref, persona, target_words, max_tokens,
        params, color, emoji, archived, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  );

  db.transaction(() => {
    for (const provider of PROVIDER_IDS) {
      const s = SEED[provider];
      insert.run(
        nanoid(12),
        s.name,
        provider,
        s.model,
        s.keyRef,
        s.persona,
        s.targetWords,
        s.maxTokens,
        JSON.stringify(s.params),
        s.color,
        s.emoji,
        nowIso(),
      );
    }
  })();
}
