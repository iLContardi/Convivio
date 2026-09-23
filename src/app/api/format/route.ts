import {
  createFormatVersion,
  currentFormatId,
  getEpisode,
  getFormat,
  setCurrentFormat,
} from "@/lib/db/episodes";
import type { Phase } from "@/lib/prompt/format";

export const dynamic = "force-dynamic";

/**
 * Senza parametri: la versione corrente, quella che riceveranno le
 * conversazioni nuove. Con `conversazione`: la versione agganciata a quella
 * conversazione, che è un documento storico e non si modifica.
 */
export async function GET(request: Request) {
  const episodeId = new URL(request.url).searchParams.get("conversazione");
  if (!episodeId) {
    return Response.json({ format: getFormat(), current: true });
  }

  const episode = getEpisode(episodeId);
  if (!episode) {
    return Response.json(
      { error: "Conversazione inesistente" },
      { status: 404 },
    );
  }

  return Response.json({
    format: getFormat(episode.formatId),
    current: episode.formatId === currentFormatId(),
    episode: { id: episode.id, topic: episode.topic, hostName: episode.hostName },
  });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    body?: string;
    phases?: Partial<Record<Phase, string>>;
    /** Adotta una versione che esiste già, invece di crearne una nuova. */
    adoptFormatId?: string;
  };

  // Adozione: sposta solo il puntatore. Serve a riportare in uso le regole di
  // una conversazione vecchia senza duplicarle e senza toccare quella
  // conversazione, che resta agganciata dov'era.
  if (body.adoptFormatId) {
    try {
      setCurrentFormat(body.adoptFormatId);
    } catch {
      return Response.json(
        { error: "Versione delle regole inesistente" },
        { status: 404 },
      );
    }
    return Response.json({ format: getFormat(), adopted: true });
  }

  // Ogni salvataggio è una versione nuova: le righe di `formats` non si
  // riscrivono, altrimenti le conversazioni che ci puntano cambierebbero
  // prompt a loro insaputa.
  const created = createFormatVersion(currentFormatId(), body);
  setCurrentFormat(created.id);
  return Response.json({ format: created });
}
