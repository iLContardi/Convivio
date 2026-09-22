import { getFormat } from "@/lib/db/episodes";
import { listGuests } from "@/lib/db/guests";
import { getSettings } from "@/lib/db/settings";
import { DEFAULT_FORMAT, PHASE_INSTRUCTIONS } from "@/lib/prompt/format";
import { FormatEditor, type FormatData } from "@/components/FormatEditor";

export const dynamic = "force-dynamic";

export default function ConfigPage() {
  const guests = listGuests().map((g) => ({
    id: g.id,
    name: g.name,
    color: g.color,
    emoji: g.emoji,
  }));

  return (
    <FormatEditor
      format={getFormat() as FormatData}
      guests={guests}
      defaults={{ body: DEFAULT_FORMAT, phases: PHASE_INSTRUCTIONS }}
      settings={getSettings()}
    />
  );
}
