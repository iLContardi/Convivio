import {
  appendPhaseDirective,
  appendTurn,
  getParticipants,
  getEpisode,
  getTurn,
  getTurns,
  nextSpeaker,
  rewindTo,
  updateEpisode,
} from "@/lib/db/episodes";
import { listGuests } from "@/lib/db/guests";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const episode = getEpisode(id);
  if (!episode) {
    return Response.json(
      { error: "Conversazione inesistente" },
      { status: 404 },
    );
  }

  return Response.json({
    episode,
    participants: getParticipants(id),
    turns: getTurns(id),
    guests: listGuests(),
    next: nextSpeaker(id),
  });
}

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json()) as {
    phase?: "apertura" | "dibattito" | "chiusura";
    status?: "live" | "paused" | "ended";
    title?: string;
    notes?: string;
    /** Intervento di chi modera: si accoda dopo il turno in corso. */
    hostMessage?: string;
    /** Riavvolge: quel turno e tutti i successivi escono di trascrizione. */
    rewindToTurnId?: string;
  };

  const current = getEpisode(id);
  if (!current) {
    return Response.json(
      { error: "Conversazione inesistente" },
      { status: 404 },
    );
  }

  // Prima di tutto il resto: riavvolgere e nello stesso colpo cambiare fase o
  // accodare un intervento non ha un ordine sensato, e il rewind rimette già
  // la fase per conto suo.
  if (body.rewindToTurnId) {
    const target = getTurn(body.rewindToTurnId);
    if (!target || target.episodeId !== id) {
      return Response.json({ error: "Turno inesistente" }, { status: 404 });
    }
    const rewound = rewindTo(body.rewindToTurnId);
    return Response.json({
      episode: getEpisode(id),
      turns: getTurns(id),
      next: nextSpeaker(id),
      rewound,
    });
  }

  if (body.hostMessage?.trim()) {
    appendTurn({
      episodeId: id,
      authorType: "host",
      content: body.hostMessage.trim(),
      status: "ok",
    });
  }

  // Il cambio di fase entra in trascrizione come indicazione di chi modera. Solo se
  // la fase cambia davvero: riselezionare quella corrente non deve produrre
  // una riga in più.
  if (body.phase && body.phase !== current.phase) {
    updateEpisode(id, { phase: body.phase });
    appendPhaseDirective(id, body.phase);
  }

  updateEpisode(id, {
    status: body.status,
    title: body.title,
    notes: body.notes,
  });

  return Response.json({
    episode: getEpisode(id),
    turns: getTurns(id),
    next: nextSpeaker(id),
  });
}
