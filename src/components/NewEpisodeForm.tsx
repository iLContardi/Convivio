"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface Guest {
  id: string;
  name: string;
  provider: string;
  model: string;
  emoji: string;
  color: string;
}

export function NewEpisodeForm({ guests }: { guests: Guest[] }) {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [brief, setBrief] = useState("");
  const [opening, setOpening] = useState("");
  // Preselezionati solo gli ospiti che hanno davvero un modello configurato.
  const [selected, setSelected] = useState<string[]>(() =>
    guests.filter((g) => g.model).map((g) => g.id),
  );
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  function toggle(id: string) {
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );
  }

  async function create() {
    setCreating(true);
    setError(null);
    const r = await fetch("/api/episodes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        topic,
        brief,
        opening,
        // L'ordine di selezione è l'ordine del giro.
        participants: selected.map((id) => ({
          guestId: id,
          role: roles[id] || null,
        })),
      }),
    });
    const d = await r.json();
    setCreating(false);
    if (!r.ok) return setError(d.error ?? "Errore");
    router.push(`/episodes/${d.episode.id}`);
  }

  const ready = topic.trim() && opening.trim() && selected.length > 0;

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14">
      <p className="text-ink-faint mb-8 font-mono text-xs tracking-[0.16em] uppercase">
        Nuova conversazione
      </p>

      {/* Il tema è la conversazione: entra in grande, come un titolo che si
          sta ancora scrivendo, non come il primo campo di un modulo. */}
      <input
        className="font-serif placeholder:text-ink-faint/60 w-full bg-transparent text-3xl leading-tight tracking-tight outline-none"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="L'infinito attuale esiste davvero?"
        aria-label="Tema della conversazione"
        autoFocus
      />
      <div className="bg-line mt-4 h-px" />

      <div className="mt-10 space-y-10">
        <Field
          label="Brief"
          hint="Le tue riflessioni di partenza. Restano visibili a tutti per tutta la conversazione, anche al turno 30."
        >
          <textarea
            className={`${input} min-h-28`}
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="Quello che ti sei già chiesto sul tema, e da dove vorresti si partisse."
          />
        </Field>

        <section>
          <h2 className="mb-1 text-sm font-medium">Al tavolo</h2>
          <p className="text-ink-dim mb-3 text-xs">
            Tocca gli ospiti nell&apos;ordine in cui vuoi che parlino: il numero
            è il loro posto nel giro.
          </p>
          <div className="space-y-2">
            {guests.map((g) => {
              const position = selected.indexOf(g.id);
              const on = position !== -1;
              return (
                <div
                  key={g.id}
                  data-guest
                  style={{ "--guest": g.color } as React.CSSProperties}
                  className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 transition-colors ${
                    on
                      ? "border-line-strong bg-panel"
                      : "border-line bg-transparent"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => g.model && toggle(g.id)}
                    disabled={!g.model}
                    aria-pressed={on}
                    className="flex items-center gap-3 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span
                      className={`flex size-7 shrink-0 items-center justify-center rounded-full font-mono text-xs transition-all ${
                        on ? "text-page" : "border-line-strong border"
                      }`}
                      style={on ? { background: g.color } : undefined}
                    >
                      {on ? position + 1 : ""}
                    </span>
                    <span
                      className={`text-sm font-medium transition-colors ${
                        on ? "guest-ink" : "text-ink-dim"
                      }`}
                    >
                      {g.name}
                    </span>
                  </button>

                  {!g.model && (
                    <span className="text-brass font-mono text-[0.6875rem]">
                      nessun modello configurato
                    </span>
                  )}

                  <input
                    className={`${input} ml-auto max-w-[16rem]`}
                    placeholder="Ruolo dialettico (facoltativo)"
                    value={roles[g.id] ?? ""}
                    onChange={(e) =>
                      setRoles((r) => ({ ...r, [g.id]: e.target.value }))
                    }
                  />
                </div>
              );
            })}
          </div>
        </section>

        <Field
          label="Introduzione"
          hint="Il tuo primo intervento: presenti il tema e dai la parola. È il turno che apre la conversazione."
        >
          <textarea
            className={`${input} min-h-24`}
            value={opening}
            onChange={(e) => setOpening(e.target.value)}
            placeholder="Benvenuti. Oggi parliamo di…"
          />
        </Field>

        {error && (
          <p className="border-live/40 bg-live/10 text-live rounded-md border px-4 py-2.5 text-sm">
            {error}
          </p>
        )}

        <div className="border-line flex items-center gap-4 border-t pt-6">
          <button
            onClick={create}
            disabled={creating || !ready}
            className="bg-ink text-page rounded-md px-5 py-2 text-sm font-medium transition-transform active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
          >
            {creating ? "Apro il tavolo…" : "Apri"}
          </button>
          {!ready && !creating && (
            <span className="text-ink-faint text-xs">
              Servono tema, introduzione e almeno un ospite.
            </span>
          )}
        </div>
      </div>
    </main>
  );
}

const input =
  "w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-ink-faint outline-none transition-colors focus:border-line-strong";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {hint && <span className="text-ink-dim mb-2 block text-xs">{hint}</span>}
      {children}
    </label>
  );
}
