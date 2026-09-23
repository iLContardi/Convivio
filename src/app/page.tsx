import Link from "next/link";
import {
  currentFormatId,
  getFormat,
  getParticipants,
  listEpisodes,
} from "@/lib/db/episodes";
import { listGuests } from "@/lib/db/guests";
import { getSettings } from "@/lib/db/settings";
import { ArchiveCard, type ArchiveEntry } from "@/components/ArchiveCard";

export const dynamic = "force-dynamic";

export default function Home() {
  const episodes = listEpisodes();
  const guests = listGuests();
  const settings = getSettings();
  const currentFormatVersion = getFormat(currentFormatId()).version;

  // Chi c'era è il modo più rapido di riconoscere una conversazione in un
  // elenco: si legge prima del titolo. Vale una query per riga, su un
  // SQLite locale che sta nella stessa cartella.
  const entries: ArchiveEntry[] = episodes.map((e) => ({
    id: e.id,
    title: e.title,
    topic: e.topic,
    status: e.status,
    phase: e.phase,
    createdAt: e.createdAt,
    turnCount: e.turnCount,
    formatVersion: getFormat(e.formatId).version,
    participants: getParticipants(e.id)
      .map((p) => guests.find((g) => g.id === p.guestId))
      .filter((g) => g !== undefined)
      .map((g) => ({ id: g.id, name: g.name, color: g.color })),
  }));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-14">
      <header className="mb-12">
        <p className="text-ink-faint font-mono text-xs tracking-[0.16em] uppercase">
          {settings.showName}
        </p>
        <h1 className="font-serif mt-2 text-4xl tracking-tight">Archivio</h1>
        <p className="text-ink-dim mt-2 max-w-lg text-sm">
          Conversazioni fra più intelligenze artificiali, moderate da{" "}
          {settings.hostName}.
        </p>
      </header>

      {entries.length === 0 ? (
        <div className="border-line rounded-xl border border-dashed px-8 py-16 text-center">
          <h2 className="font-serif text-xl">Il tavolo è vuoto</h2>
          <p className="text-ink-dim mx-auto mt-2 max-w-sm text-sm">
            Scegli un tema, porta le tue riflessioni di partenza e decidi chi
            siede al tavolo.
          </p>
          <Link
            href="/episodes/new"
            className="bg-ink text-page mt-6 inline-block rounded-md px-4 py-2 text-sm font-medium transition-transform active:scale-[0.97]"
          >
            Apri la prima conversazione
          </Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {entries.map((entry) => (
            <ArchiveCard
              key={entry.id}
              entry={entry}
              currentFormatVersion={currentFormatVersion}
            />
          ))}
        </ul>
      )}
    </main>
  );
}
