import { notFound } from "next/navigation";
import { currentFormatId, getEpisode, getFormat } from "@/lib/db/episodes";
import { listGuests } from "@/lib/db/guests";
import { getSettings } from "@/lib/db/settings";
import { DEFAULT_FORMAT, PHASE_INSTRUCTIONS } from "@/lib/prompt/format";
import { FormatEditor, type FormatData } from "@/components/FormatEditor";

export const dynamic = "force-dynamic";

/**
 * Due modi di guardare le stesse regole, distinti dall'indirizzo.
 *
 * Senza parametri si modifica la versione corrente, quella che riceveranno le
 * conversazioni nuove. Con `?conversazione=<id>` si guarda la versione
 * agganciata a quella conversazione: è un documento storico e non si tocca,
 * perché cambiarla significherebbe riscrivere il prompt sotto una
 * conversazione già avvenuta. Da lì si può però adottarla come corrente.
 */
export default async function ConfigPage({
  searchParams,
}: PageProps<"/config">) {
  const params = await searchParams;
  const episodeId =
    typeof params.conversazione === "string" ? params.conversazione : null;

  const guests = listGuests().map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    emoji: g.emoji,
  }));

  if (!episodeId) {
    return (
      <FormatEditor
        format={getFormat() as FormatData}
        guests={guests}
        defaults={{ body: DEFAULT_FORMAT, phases: PHASE_INSTRUCTIONS }}
        settings={getSettings()}
      />
    );
  }

  const episode = getEpisode(episodeId);
  if (!episode) notFound();

  return (
    <FormatEditor
      format={getFormat(episode.formatId) as FormatData}
      guests={guests}
      defaults={{ body: DEFAULT_FORMAT, phases: PHASE_INSTRUCTIONS }}
      settings={getSettings()}
      pinnedTo={{
        episodeId: episode.id,
        topic: episode.topic,
        hostName: episode.hostName,
        isCurrent: episode.formatId === currentFormatId(),
      }}
    />
  );
}
