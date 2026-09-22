import { getFormat } from "@/lib/db/episodes";
import { listGuests } from "@/lib/db/guests";
import { getSettings } from "@/lib/db/settings";
import { composeSystemPrompt } from "@/lib/prompt/compose";
import type { Phase } from "@/lib/prompt/format";

export const dynamic = "force-dynamic";

/**
 * Il prompt di sistema esattamente come lo riceverà l'ospite scelto, montando
 * i tre strati su una conversazione d'esempio. Serve a vedere l'effetto di
 * una modifica alle regole prima di scoprirlo a conversazione avviata.
 */
export async function POST(request: Request) {
  const { guestId, phase, body, phases } = (await request.json()) as {
    guestId?: string;
    phase?: Phase;
    body?: string;
    phases?: Partial<Record<Phase, string>>;
  };

  const guests = listGuests();
  const speaker = guests.find((g) => g.id === guestId) ?? guests[0];
  if (!speaker) {
    return Response.json({ error: "Nessun ospite configurato" }, { status: 400 });
  }

  const stored = getFormat();
  const currentPhase: Phase = phase ?? "apertura";
  // Si usa il testo che l'utente ha davanti nell'editor, non quello salvato:
  // l'anteprima deve riflettere le modifiche non ancora confermate.
  const phaseInstruction =
    phases?.[currentPhase]?.trim() || stored.phases[currentPhase];

  const others = guests
    .filter((g) => g.id !== speaker.id)
    .map((g) => ({
      guestId: g.id,
      name: g.name,
      persona: g.persona,
      role: null,
    }));

  const settings = getSettings();

  const preview = composeSystemPrompt({
    formatBody: body?.trim() ? body : stored.body,
    showName: settings.showName,
    speaker: {
      guestId: speaker.id,
      name: speaker.name,
      persona: speaker.persona,
      role: "Fai l'avvocato del diavolo: cerca il punto debole.",
    },
    others,
    hostName: settings.hostName,
    topic: "L'infinito attuale è una scoperta o un'invenzione?",
    brief:
      "(qui comparirà il brief della conversazione, con le tue riflessioni di partenza)",
    targetWords: speaker.targetWords,
  });

  // La direttiva di fase non sta nel prompt di sistema ma in coda alla
  // conversazione: mostrarla separata riflette dove finisce davvero.
  const full = [
    preview,
    "",
    "————— in coda alla conversazione, come turno di moderazione —————",
    "",
    // Deve combaciare con l'etichetta che `projectTranscript` mette davvero
    // ai turni di sistema: se le due divergono, l'anteprima mostra qualcosa
    // che l'ospite non riceve.
    `**Moderazione:** ${phaseInstruction}`,
  ].join("\n");

  return Response.json({ preview: full, guestName: speaker.name });
}
