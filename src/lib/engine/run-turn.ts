import "server-only";

import {
  appendTurn,
  finishTurn,
  getParticipants,
  getEpisode,
  getFormat,
  getTurn,
  getTurns,
  nextSpeaker,
  supersedeTurn,
  type Turn,
} from "@/lib/db/episodes";
import { getGuestById } from "@/lib/db/guests";
import { getSettings } from "@/lib/db/settings";
import { getProvider } from "@/lib/providers";
import {
  composeSystemPrompt,
  projectTranscript,
  type SpeakerInfo,
} from "@/lib/prompt/compose";
import { backoffMs, humanizeError, isRetryable, MAX_ATTEMPTS } from "./errors";

export type EngineEvent =
  | { type: "start"; turnId: string; guestId: string; guestName: string }
  | { type: "text"; text: string }
  | { type: "done"; turn: Turn }
  | { type: "error"; message: string };

/**
 * Genera un turno: compone il prompt, chiama il provider in streaming e
 * persiste. Il turno è inserito PRIMA della chiamata, così prenota il proprio
 * posto nel giro anche se chi modera interviene mentre l'ospite scrive.
 */
export async function* runTurn(
  episodeId: string,
  options: {
    guestId?: string;
    /** Id del turno da rifare: stesso ospite, stesso posto nel giro. */
    regenerateTurnId?: string;
    signal?: AbortSignal;
  } = {},
): AsyncGenerator<EngineEvent> {
  const episode = getEpisode(episodeId);
  if (!episode) {
    yield { type: "error", message: "Conversazione inesistente" };
    return;
  }

  const replaced = options.regenerateTurnId
    ? getTurn(options.regenerateTurnId)
    : null;

  if (options.regenerateTurnId && !replaced) {
    yield { type: "error", message: "Turno da rigenerare inesistente" };
    return;
  }

  const participants = getParticipants(episodeId);
  const targetGuestId = replaced?.guestId ?? options.guestId;
  const member = targetGuestId
    ? participants.find((c) => c.guestId === targetGuestId)
    : nextSpeaker(episodeId);

  if (!member) {
    yield { type: "error", message: "Nessun ospite al tavolo" };
    return;
  }

  const guest = getGuestById(member.guestId);
  if (!guest) {
    yield { type: "error", message: "Ospite non trovato" };
    return;
  }
  if (!guest.model) {
    yield {
      type: "error",
      message: `${guest.name} non ha un modello configurato.`,
    };
    return;
  }

  const speaker: SpeakerInfo = {
    guestId: guest.id,
    name: guest.name,
    persona: guest.persona,
    role: member.role,
  };

  const others: SpeakerInfo[] = participants
    .filter((c) => c.guestId !== guest.id)
    .map((c) => {
      const g = getGuestById(c.guestId);
      return {
        guestId: c.guestId,
        name: g?.name ?? "Ospite",
        persona: g?.persona ?? "",
        role: c.role,
      };
    });

  const format = getFormat(episode.formatId);
  const settings = getSettings();

  const system = composeSystemPrompt({
    formatBody: format.body,
    showName: settings.showName,
    speaker,
    others,
    hostName: episode.hostName,
    topic: episode.topic,
    brief: episode.brief,

    targetWords: guest.targetWords,
  });

  const nameOf = buildNameResolver(episode.hostName, [speaker, ...others]);
  // Rigenerando, il turno da rifare non deve comparire nel contesto: altrimenti
  // l'ospite riscriverebbe avendo davanti la propria versione precedente.
  const history = getTurns(episodeId).filter((t) => t.id !== replaced?.id);
  const messages = projectTranscript(
    history,
    guest.id,
    nameOf,
    episode.hostName,
  );

  const turn = appendTurn({
    episodeId,
    authorType: "guest",
    guestId: guest.id,
    content: "",
    status: "pending",
    ordinal: replaced?.ordinal,
  });

  if (replaced) supersedeTurn(replaced.id, turn.id);

  yield {
    type: "start",
    turnId: turn.id,
    guestId: guest.id,
    guestName: guest.name,
  };

  const started = Date.now();
  let text = "";
  let lastError: unknown = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const stream = getProvider(guest.provider).stream({
        model: guest.model,
        system,
        messages,
        maxTokens: guest.maxTokens,
        params: guest.params,
        cacheKey: `${episodeId}:${guest.id}`,
        signal: options.signal,
      });

      let usage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, cacheWriteTokens: 0 };
      let model = guest.model;

      for await (const event of stream) {
        if (event.type === "text") {
          text += event.text;
          yield { type: "text", text: event.text };
        } else {
          usage = event.usage;
          model = event.model;
        }
      }

      finishTurn(turn.id, {
        content: text.trim(),
        status: options.signal?.aborted ? "interrupted" : "ok",
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cachedTokens: usage.cachedTokens,
        cacheWriteTokens: usage.cacheWriteTokens,
        latencyMs: Date.now() - started,
      });

      yield { type: "done", turn: { ...turn, content: text.trim() } };
      return;
    } catch (error) {
      lastError = error;

      // Testo già arrivato prima dell'interruzione: si tiene, marcato.
      if ((error as { name?: string })?.name === "AbortError") {
        finishTurn(turn.id, {
          content: text.trim(),
          status: "interrupted",
          latencyMs: Date.now() - started,
        });
        yield { type: "done", turn: { ...turn, content: text.trim() } };
        return;
      }

      if (!isRetryable(error) || attempt === MAX_ATTEMPTS - 1) break;
      await sleep(backoffMs(attempt));
      text = "";
    }
  }

  // Un ospite che fallisce non deve bloccare la conversazione: il turno resta in
  // trascrizione come errore e il giro prosegue.
  const message = humanizeError(lastError);
  finishTurn(turn.id, {
    content: `[${guest.name} non ha potuto rispondere: ${message}]`,
    status: "error",
    latencyMs: Date.now() - started,
  });
  yield { type: "error", message };
}

function buildNameResolver(hostName: string, speakers: SpeakerInfo[]) {
  const names = new Map(speakers.map((s) => [s.guestId, s.name]));
  return (turn: { authorType: string; guestId: string | null }) => {
    if (turn.authorType === "host") return hostName;
    return names.get(turn.guestId ?? "") ?? "Ospite";
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
