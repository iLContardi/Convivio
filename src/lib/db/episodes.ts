import "server-only";

import { nanoid } from "nanoid";
import { getDb, nowIso } from "./index";
import { getRawSetting, getSettings, setRawSetting } from "./settings";
import {
  DEFAULT_FORMAT,
  PHASE_INSTRUCTIONS,
  type Phase,
} from "@/lib/prompt/format";

export type TurnStatus = "pending" | "ok" | "interrupted" | "error";
export type AuthorType = "host" | "guest" | "system";
export type EpisodeStatus = "draft" | "live" | "paused" | "ended";

export interface Turn {
  id: string;
  episodeId: string;
  ordinal: number;
  authorType: AuthorType;
  guestId: string | null;
  content: string;
  status: TurnStatus;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  latencyMs: number | null;
  createdAt: string;
}

export interface Participant {
  guestId: string;
  position: number;
  role: string | null;
}

export interface Episode {
  id: string;
  title: string | null;
  topic: string;
  brief: string;
  formatId: string;
  hostName: string;
  phase: Phase;
  status: EpisodeStatus;
  notes: string;
  createdAt: string;
  endedAt: string | null;
}

// ---------------------------------------------------------------- format

export interface FormatRecord {
  id: string;
  name: string;
  body: string;
  version: number;
  phases: Record<Phase, string>;
}

/** Chiave in `settings` che indica quale versione ricevono le conversazioni nuove. */
const CURRENT_FORMAT_KEY = "currentFormatId";

/**
 * L'id della versione corrente delle regole.
 *
 * Il puntatore è esplicito invece di «la riga più recente» per due motivi: si
 * può tornare a una versione precedente senza cancellare quelle in mezzo, e
 * soprattutto «la più vecchia» — come faceva la vecchia implementazione —
 * resterebbe incollata alla v1 per sempre una volta introdotte le versioni.
 */
export function currentFormatId(): string {
  const db = getDb();

  const pinned = getRawSetting(CURRENT_FORMAT_KEY);
  if (pinned) {
    const exists = db
      .prepare("SELECT id FROM formats WHERE id = ?")
      .get(pinned) as { id: string } | undefined;
    if (exists) return exists.id;
  }

  // Nessun puntatore: o è la prima esecuzione, o è un database creato prima
  // che le versioni esistessero. In entrambi i casi la riga più recente è
  // quella giusta da adottare.
  const latest = db
    .prepare("SELECT id FROM formats ORDER BY version DESC, created_at DESC LIMIT 1")
    .get() as { id: string } | undefined;

  if (latest) {
    setRawSetting(CURRENT_FORMAT_KEY, latest.id);
    return latest.id;
  }

  const id = nanoid(12);
  db.prepare(
    "INSERT INTO formats (id, name, body, version, phases, created_at) VALUES (?, ?, ?, 1, ?, ?)",
  ).run(
    id,
    "Regole standard",
    DEFAULT_FORMAT,
    JSON.stringify(PHASE_INSTRUCTIONS),
    nowIso(),
  );
  setRawSetting(CURRENT_FORMAT_KEY, id);
  return id;
}

/** Sposta il puntatore su una versione che esiste già. Non ne crea di nuove. */
export function setCurrentFormat(formatId: string): void {
  const exists = getDb()
    .prepare("SELECT id FROM formats WHERE id = ?")
    .get(formatId);
  if (!exists) throw new Error("Versione delle regole inesistente");
  setRawSetting(CURRENT_FORMAT_KEY, formatId);
}

/** Senza id restituisce la versione corrente delle regole. */
export function getFormat(formatId?: string): FormatRecord {
  const id = formatId ?? currentFormatId();
  const row = getDb()
    .prepare("SELECT id, name, body, version, phases FROM formats WHERE id = ?")
    .get(id) as
    | {
        id: string;
        name: string;
        body: string;
        version: number;
        phases: string;
      }
    | undefined;

  if (!row) {
    return {
      id,
      name: "Regole standard",
      body: DEFAULT_FORMAT,
      version: 1,
      phases: PHASE_INSTRUCTIONS,
    };
  }

  // Le conversazioni create prima che le fasi fossero editabili hanno `{}`: si
  // ricade sui testi predefiniti invece di comporre un prompt monco.
  const stored = JSON.parse(row.phases || "{}") as Partial<
    Record<Phase, string>
  >;

  return {
    id: row.id,
    name: row.name,
    body: row.body,
    version: row.version,
    phases: { ...PHASE_INSTRUCTIONS, ...stripEmpty(stored) },
  };
}

/**
 * Crea una versione nuova delle regole a partire da una esistente.
 *
 * Le righe di `formats` sono immutabili: non si aggiorna mai il corpo di una
 * versione già scritta. È l'unica cosa che rende `episodes.format_id` una
 * garanzia invece di un riferimento a un bersaglio mobile — prima, modificare
 * le regole riscriveva retroattivamente il prompt di ogni conversazione
 * passata, senza che se ne accorgesse nessuno.
 */
export function createFormatVersion(
  fromFormatId: string,
  patch: { body?: string; phases?: Partial<Record<Phase, string>> },
): FormatRecord {
  const db = getDb();
  const base = getFormat(fromFormatId);

  const id = nanoid(12);
  const next = db
    .prepare("SELECT COALESCE(MAX(version), 0) + 1 AS n FROM formats")
    .get() as { n: number };

  db.prepare(
    "INSERT INTO formats (id, name, body, version, phases, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    base.name,
    patch.body ?? base.body,
    next.n,
    JSON.stringify({ ...base.phases, ...stripEmpty(patch.phases ?? {}) }),
    nowIso(),
  );

  return getFormat(id);
}

function stripEmpty(
  input: Partial<Record<Phase, string>>,
): Partial<Record<Phase, string>> {
  const out: Partial<Record<Phase, string>> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.trim()) {
      out[key as Phase] = value;
    }
  }
  return out;
}

// --------------------------------------------------------------- episodi

export function createEpisode(input: {
  topic: string;
  brief?: string;
  hostName?: string;
  participants: { guestId: string; role?: string | null }[];
  opening: string;
}): Episode {
  const db = getDb();
  const id = nanoid(12);
  const formatId = currentFormatId();

  db.transaction(() => {
    db.prepare(
      `INSERT INTO episodes (id, topic, brief, format_id, host_name, phase, status, notes, created_at)
       VALUES (?, ?, ?, ?, ?, 'apertura', 'live', '', ?)`,
    ).run(
      id,
      input.topic,
      input.brief ?? "",
      formatId,
      input.hostName ?? getSettings().hostName,
      nowIso(),
    );

    const addCast = db.prepare(
      "INSERT INTO episode_guests (episode_id, guest_id, position, role) VALUES (?, ?, ?, ?)",
    );
    input.participants.forEach((c, i) => addCast.run(id, c.guestId, i, c.role ?? null));
  })();

  // L'introduzione di chi modera è il primo turno: senza, il primo ospite si
  // troverebbe a parlare senza che nessuno gli abbia rivolto la parola.
  appendTurn({
    episodeId: id,
    authorType: "host",
    content: input.opening,
    status: "ok",
  });

  // Anche la fase iniziale è una direttiva esplicita: altrimenti il giro di
  // apertura sarebbe l'unico a partire senza indicazione di chi modera.
  appendPhaseDirective(id, "apertura");

  return getEpisode(id)!;
}

export function getEpisode(id: string): Episode | null {
  const row = getDb()
    .prepare("SELECT * FROM episodes WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  return {
    id: row.id as string,
    title: (row.title as string) ?? null,
    topic: row.topic as string,
    brief: (row.brief as string) ?? "",
    formatId: row.format_id as string,
    hostName: row.host_name as string,
    phase: row.phase as Phase,
    status: row.status as EpisodeStatus,
    notes: (row.notes as string) ?? "",
    createdAt: row.created_at as string,
    endedAt: (row.ended_at as string) ?? null,
  };
}

export function listEpisodes(): (Episode & { turnCount: number })[] {
  const rows = getDb()
    .prepare(
      `SELECT e.*, (SELECT COUNT(*) FROM turns t WHERE t.episode_id = e.id) AS turn_count
       FROM episodes e ORDER BY e.created_at DESC`,
    )
    .all() as Record<string, unknown>[];

  return rows.map((row) => ({
    ...getEpisodeFromRow(row),
    turnCount: row.turn_count as number,
  }));
}

function getEpisodeFromRow(row: Record<string, unknown>): Episode {
  return {
    id: row.id as string,
    title: (row.title as string) ?? null,
    topic: row.topic as string,
    brief: (row.brief as string) ?? "",
    formatId: row.format_id as string,
    hostName: row.host_name as string,
    phase: row.phase as Phase,
    status: row.status as EpisodeStatus,
    notes: (row.notes as string) ?? "",
    createdAt: row.created_at as string,
    endedAt: (row.ended_at as string) ?? null,
  };
}

export function updateEpisode(
  id: string,
  patch: Partial<Pick<Episode, "phase" | "status" | "title" | "notes">>,
): void {
  const fields: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    fields.push(`${key === "endedAt" ? "ended_at" : key} = ?`);
    values.push(value);
  }
  if (!fields.length) return;
  values.push(id);
  getDb()
    .prepare(`UPDATE episodes SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values);
}

// ------------------------------------------------------------------ participants

export function getParticipants(episodeId: string): Participant[] {
  const rows = getDb()
    .prepare(
      `SELECT guest_id, position, role FROM episode_guests
       WHERE episode_id = ? AND left_at_turn IS NULL
       ORDER BY position ASC`,
    )
    .all(episodeId) as Record<string, unknown>[];

  return rows.map((r) => ({
    guestId: r.guest_id as string,
    position: r.position as number,
    role: (r.role as string) ?? null,
  }));
}

// ----------------------------------------------------------------- turni

export function getTurns(episodeId: string): Turn[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM turns WHERE episode_id = ?
         AND superseded_by IS NULL AND discarded_at IS NULL
       ORDER BY ordinal ASC`,
    )
    .all(episodeId) as Record<string, unknown>[];

  return rows.map((r) => ({
    id: r.id as string,
    episodeId: r.episode_id as string,
    ordinal: r.ordinal as number,
    authorType: r.author_type as AuthorType,
    guestId: (r.guest_id as string) ?? null,
    content: r.content as string,
    status: r.status as TurnStatus,
    model: (r.model as string) ?? null,
    inputTokens: (r.input_tokens as number) ?? null,
    outputTokens: (r.output_tokens as number) ?? null,
    cachedTokens: (r.cached_tokens as number) ?? null,
    cacheWriteTokens: (r.cache_write_tokens as number) ?? null,
    latencyMs: (r.latency_ms as number) ?? null,
    createdAt: r.created_at as string,
  }));
}

/**
 * Inserisce un turno prendendo l'ordinale successivo dentro una transazione.
 *
 * È questo che dà la semantica di accodamento senza codice dedicato: se un
 * ospite sta generando, il suo turno ha già prenotato il proprio ordinale, e
 * un intervento di chi modera che arriva nel frattempo si mette in coda dopo
 * di lui invece di sovrascriverlo.
 */
export function appendTurn(input: {
  episodeId: string;
  authorType: AuthorType;
  guestId?: string | null;
  content: string;
  status: TurnStatus;
  /** Per un rigenera: il nuovo turno prende il posto di quello sostituito. */
  ordinal?: number;
  /** Solo sui turni di sistema: la fase che l'indicazione apre. */
  phase?: Phase;
}): Turn {
  const db = getDb();
  const id = nanoid(12);

  db.transaction(() => {
    const next =
      input.ordinal !== undefined
        ? { n: input.ordinal }
        : (db
            .prepare(
              "SELECT COALESCE(MAX(ordinal), 0) + 1 AS n FROM turns WHERE episode_id = ?",
            )
            .get(input.episodeId) as { n: number });

    db.prepare(
      `INSERT INTO turns (id, episode_id, ordinal, author_type, guest_id, content, status, phase, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.episodeId,
      next.n,
      input.authorType,
      input.guestId ?? null,
      input.content,
      input.status,
      input.phase ?? null,
      nowIso(),
    );
  })();

  return getTurn(id)!;
}

export function getTurn(id: string): Turn | null {
  const row = getDb()
    .prepare("SELECT * FROM turns WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    episodeId: row.episode_id as string,
    ordinal: row.ordinal as number,
    authorType: row.author_type as AuthorType,
    guestId: (row.guest_id as string) ?? null,
    content: row.content as string,
    status: row.status as TurnStatus,
    model: (row.model as string) ?? null,
    inputTokens: (row.input_tokens as number) ?? null,
    outputTokens: (row.output_tokens as number) ?? null,
    cachedTokens: (row.cached_tokens as number) ?? null,
    cacheWriteTokens: (row.cache_write_tokens as number) ?? null,
    latencyMs: (row.latency_ms as number) ?? null,
    createdAt: row.created_at as string,
  };
}

export function finishTurn(
  id: string,
  patch: {
    content: string;
    status: TurnStatus;
    model?: string | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    cachedTokens?: number | null;
    cacheWriteTokens?: number | null;
    latencyMs?: number | null;
  },
): void {
  getDb()
    .prepare(
      `UPDATE turns SET content = ?, status = ?, model = ?, input_tokens = ?,
         output_tokens = ?, cached_tokens = ?, cache_write_tokens = ?,
         latency_ms = ? WHERE id = ?`,
    )
    .run(
      patch.content,
      patch.status,
      patch.model ?? null,
      patch.inputTokens ?? null,
      patch.outputTokens ?? null,
      patch.cachedTokens ?? null,
      patch.cacheWriteTokens ?? null,
      patch.latencyMs ?? null,
      id,
    );
}

/**
 * Registra un cambio di fase come turno di moderazione.
 *
 * È un turno vero e permanente, non un'appendice ricostruita a ogni richiesta:
 * così la trascrizione resta append-only — condizione perché i messaggi di un
 * turno siano prefisso esatto di quelli del turno dopo, e la cache regga — e
 * l'indicazione resta leggibile in archivio a conversazione finita.
 */
export function appendPhaseDirective(episodeId: string, phase: Phase): Turn {
  const episode = getEpisode(episodeId);
  const instruction = getFormat(episode?.formatId).phases[phase];

  return appendTurn({
    episodeId,
    authorType: "system",
    content: instruction,
    status: "ok",
    // Serve al rewind: è l'unico modo di sapere dopo a che fase riporta
    // un'indicazione, visto che il suo testo è editabile.
    phase,
  });
}

/**
 * Riavvolge la conversazione a prima di un turno: quel turno e tutti quelli
 * dopo spariscono dalla trascrizione.
 *
 * Non cancella niente — mette una data in `discarded_at`, esattamente come il
 * rigenera non distrugge la presa che sostituisce. Il resto si sistema da sé:
 * `nextSpeaker` deriva il posto nel giro dai turni visibili, quindi riavvolgendo
 * torna indietro anche il turno di parola, e `appendTurn` prende sempre
 * `MAX(ordinal) + 1` contando pure i turni nascosti, così i turni nuovi non
 * possono collidere con quelli riavvolti.
 *
 * La fase invece va rimessa a mano, ed è l'unico punto davvero insidioso: sta
 * in una colonna di `episodes` ma nasce da un'indicazione in trascrizione.
 * Riavvolgendo oltre un cambio di fase la colonna resterebbe avanti, e siccome
 * `PATCH` appende una nuova indicazione solo se la fase *cambia*, riselezionare
 * quella giusta non produrrebbe nulla: la conversazione proseguirebbe senza mai
 * ricevere la direttiva. Nessun errore, solo ospiti convinti di essere altrove.
 *
 * Restituisce quanti turni sono stati riavvolti.
 */
export function rewindTo(turnId: string): number {
  const db = getDb();
  const target = getTurn(turnId);
  if (!target) return 0;

  return db.transaction(() => {
    const { changes } = db
      .prepare(
        `UPDATE turns SET discarded_at = ?
         WHERE episode_id = ? AND ordinal >= ?
           AND superseded_by IS NULL AND discarded_at IS NULL`,
      )
      .run(nowIso(), target.episodeId, target.ordinal);

    const directive = db
      .prepare(
        `SELECT phase FROM turns
         WHERE episode_id = ? AND author_type = 'system' AND phase IS NOT NULL
           AND superseded_by IS NULL AND discarded_at IS NULL
         ORDER BY ordinal DESC LIMIT 1`,
      )
      .get(target.episodeId) as { phase: Phase } | undefined;

    // Nessuna indicazione superstite significa essere tornati prima di quella
    // di apertura, che ogni conversazione riceve alla creazione.
    db.prepare("UPDATE episodes SET phase = ? WHERE id = ?").run(
      directive?.phase ?? "apertura",
      target.episodeId,
    );

    return changes;
  })();
}

/**
 * Marca un turno come sostituito da un altro. Non cancella: la presa scartata
 * resta nel database, semplicemente sparisce dalla trascrizione.
 */
export function supersedeTurn(oldId: string, newId: string): void {
  getDb()
    .prepare("UPDATE turns SET superseded_by = ? WHERE id = ?")
    .run(newId, oldId);
}

/** Chi parla adesso: il giro riprende dall'ospite dopo l'ultimo che ha parlato. */
export function nextSpeaker(episodeId: string): Participant | null {
  const participants = getParticipants(episodeId);
  if (!participants.length) return null;

  const turns = getTurns(episodeId);
  const lastGuestTurn = [...turns]
    .reverse()
    .find((t) => t.authorType === "guest" && t.guestId);

  if (!lastGuestTurn) return participants[0];

  const index = participants.findIndex((c) => c.guestId === lastGuestTurn.guestId);
  if (index === -1) return participants[0];
  return participants[(index + 1) % participants.length];
}
