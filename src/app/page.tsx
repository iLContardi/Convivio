import Link from "next/link";
import { getParticipants, listEpisodes } from "@/lib/db/episodes";
import { listGuests } from "@/lib/db/guests";
import { getSettings } from "@/lib/db/settings";

export const dynamic = "force-dynamic";

/**
 * In archivio `live` non significa che la conversazione sta andando adesso:
 * significa che non è mai stata chiusa. Da qui non si può sapere se c'è uno
 * stream attivo, quindi si dice «aperta» — cioè: puoi rientrarci. Il rosso
 * pulsante resta nella conversazione stessa, l'unico posto che lo sa davvero;
 * usarlo anche qui lo renderebbe lo stato normale di ogni riga, e uno stato
 * che vale per tutti non è più un segnale.
 */
const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "bozza", className: "text-ink-faint" },
  live: { label: "aperta", className: "text-brass" },
  paused: { label: "in pausa", className: "text-brass" },
  ended: { label: "chiusa", className: "text-ink-faint" },
};

export default function Home() {
  const episodes = listEpisodes();
  const guests = listGuests();
  const settings = getSettings();
  // Chi c'era è il modo più rapido di riconoscere una conversazione in un
  // elenco: si legge prima del titolo. Vale una query per riga, su un
  // SQLite locale che sta nella stessa cartella.
  const participantsOf = new Map(
    episodes.map((e) => [
      e.id,
      getParticipants(e.id)
        .map((c) => guests.find((g) => g.id === c.guestId))
        .filter((g) => g !== undefined),
    ]),
  );

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

      {episodes.length === 0 ? (
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
          {episodes.map((e) => {
            const participants = participantsOf.get(e.id) ?? [];
            const status = STATUS[e.status] ?? STATUS.draft;
            return (
              <li key={e.id}>
                <Link
                  href={`/episodes/${e.id}`}
                  className="border-line bg-panel hover:border-line-strong hover:bg-raised group flex h-full flex-col rounded-xl border p-5 transition-colors"
                >
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className={`font-mono text-[0.6875rem] tracking-[0.12em] uppercase ${status.className}`}
                    >
                      {e.status !== "ended" && (
                        <span className="bg-brass mr-1.5 inline-block size-1.5 rounded-full align-middle" />
                      )}
                      {status.label}
                    </span>
                    <span className="text-ink-faint font-mono text-[0.6875rem]">
                      {e.phase}
                    </span>
                    <span className="text-ink-faint ml-auto font-mono text-[0.6875rem]">
                      {new Date(e.createdAt).toLocaleDateString("it", {
                        day: "2-digit",
                        month: "short",
                        year: "2-digit",
                      })}
                    </span>
                  </div>

                  <h2 className="font-serif group-hover:text-white text-[1.0625rem] leading-snug text-balance transition-colors">
                    {e.title ?? e.topic}
                  </h2>

                  <div className="mt-auto flex items-center gap-3 pt-5">
                    <div className="flex items-center gap-1.5">
                      {participants.map((g) => (
                        <span
                          key={g.id}
                          title={g.name}
                          className="size-2 rounded-full"
                          style={{ background: g.color }}
                        />
                      ))}
                    </div>
                    <span className="text-ink-faint font-mono text-[0.6875rem]">
                      {e.turnCount} turni
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
