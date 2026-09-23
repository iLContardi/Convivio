"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export interface ArchiveParticipant {
  id: string;
  name: string;
  color: string;
}

export interface ArchiveEntry {
  id: string;
  title: string | null;
  topic: string;
  status: string;
  phase: string;
  createdAt: string;
  turnCount: number;
  participants: ArchiveParticipant[];
  /** La versione delle regole con cui è stata condotta. */
  formatVersion: number;
}

const STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "bozza", className: "text-ink-faint" },
  live: { label: "aperta", className: "text-brass" },
  paused: { label: "in pausa", className: "text-brass" },
  ended: { label: "chiusa", className: "text-ink-faint" },
};

type Panel = null | "menu" | "rename" | "duplicate" | "delete";

export function ArchiveCard({
  entry,
  currentFormatVersion,
}: {
  entry: ArchiveEntry;
  currentFormatVersion: number;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>(null);
  const [title, setTitle] = useState(entry.title ?? entry.topic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLLIElement>(null);

  // Un menu che resta aperto dopo che hai guardato altrove è solo un ostacolo.
  useEffect(() => {
    if (panel !== "menu") return;
    function away(event: MouseEvent) {
      if (!root.current?.contains(event.target as Node)) setPanel(null);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setPanel(null);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [panel]);

  const status = STATUS[entry.status] ?? STATUS.draft;
  const sameRules = entry.formatVersion === currentFormatVersion;

  async function call(input: RequestInfo, init: RequestInit) {
    setBusy(true);
    setError(null);
    const r = await fetch(input, init);
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) {
      setError(d.error ?? "Non ha funzionato");
      return null;
    }
    return d;
  }

  async function rename() {
    const next = title.trim();
    if (!next) return;
    const d = await call(`/api/episodes/${entry.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
    if (d) {
      setPanel(null);
      router.refresh();
    }
  }

  async function duplicate(useCurrentFormat: boolean) {
    const d = await call(`/api/episodes/${entry.id}/duplicate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ useCurrentFormat }),
    });
    if (d?.episode) router.push(`/episodes/${d.episode.id}`);
  }

  async function remove() {
    const d = await call(`/api/episodes/${entry.id}`, { method: "DELETE" });
    if (d) {
      setPanel(null);
      router.refresh();
    }
  }

  return (
    <li ref={root} className="relative">
      <Link
        href={`/episodes/${entry.id}`}
        className="border-line bg-panel hover:border-line-strong hover:bg-raised group flex h-full flex-col rounded-xl border p-5 transition-colors"
      >
        <div className="mb-3 flex items-center gap-2">
          <span
            className={`font-mono text-[0.6875rem] tracking-[0.12em] uppercase ${status.className}`}
          >
            {entry.status !== "ended" && (
              <span className="bg-brass mr-1.5 inline-block size-1.5 rounded-full align-middle" />
            )}
            {status.label}
          </span>
          <span className="text-ink-faint font-mono text-[0.6875rem]">
            {entry.phase}
          </span>
          <span className="text-ink-faint ml-auto font-mono text-[0.6875rem]">
            {new Date(entry.createdAt).toLocaleDateString("it", {
              day: "2-digit",
              month: "short",
              year: "2-digit",
            })}
          </span>
        </div>

        <h2 className="font-serif group-hover:text-white text-[1.0625rem] leading-snug text-balance transition-colors">
          {entry.title ?? entry.topic}
        </h2>

        <div className="mt-auto flex items-center gap-3 pt-5">
          <div className="flex items-center gap-1.5">
            {entry.participants.map((p) => (
              <span
                key={p.id}
                title={p.name}
                className="size-2 rounded-full"
                style={{ background: p.color }}
              />
            ))}
          </div>
          <span className="text-ink-faint font-mono text-[0.6875rem]">
            {entry.turnCount} turni
          </span>
          <span className="text-ink-faint font-mono text-[0.6875rem]">
            regole v{entry.formatVersion}
          </span>
        </div>
      </Link>

      {/* Fuori dal Link: un bottone dentro un'ancora è markup non valido e il
          click finirebbe per navigare comunque. */}
      <button
        onClick={() => setPanel(panel === "menu" ? null : "menu")}
        aria-label="Azioni su questa conversazione"
        aria-expanded={panel === "menu"}
        className="text-ink-faint hover:text-ink hover:bg-raised absolute right-3 bottom-3 rounded-md px-2 py-1 text-sm leading-none transition-colors"
      >
        ···
      </button>

      {panel === "menu" && (
        <div className="border-line bg-raised absolute right-3 bottom-10 z-20 w-44 overflow-hidden rounded-lg border py-1 shadow-lg">
          <MenuItem onClick={() => setPanel("rename")}>Rinomina</MenuItem>
          <MenuItem onClick={() => setPanel("duplicate")}>Duplica</MenuItem>
          <MenuItem onClick={() => setPanel("delete")} danger>
            Elimina
          </MenuItem>
        </div>
      )}

      {panel && panel !== "menu" && (
        <div className="border-line-strong bg-panel absolute inset-0 z-30 flex flex-col justify-center rounded-xl border p-5">
          {panel === "rename" && (
            <>
              <label className="text-ink-dim mb-1.5 block text-xs">
                Titolo della conversazione
              </label>
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename();
                  if (e.key === "Escape") setPanel(null);
                }}
                className="border-line bg-raised text-ink focus:border-line-strong w-full rounded-md border px-3 py-1.5 text-sm outline-none"
              />
              <p className="text-ink-faint mt-1.5 text-[0.6875rem]">
                Cambia solo l&apos;etichetta in archivio. Il tema che leggono
                gli ospiti resta quello originale.
              </p>
              <Actions
                busy={busy}
                onCancel={() => setPanel(null)}
                confirm="Rinomina"
                onConfirm={rename}
                disabled={!title.trim()}
              />
            </>
          )}

          {panel === "duplicate" && (
            <>
              <p className="text-ink text-sm">
                Riparte dalle stesse premesse: tema, brief, chi era al tavolo
                con i suoi ruoli, e il solo intervento di apertura.
              </p>
              <p className="text-ink-dim mt-1.5 text-[0.6875rem] leading-snug">
                Nessun turno degli ospiti viene copiato. I modelli sono
                configurazione globale, quindi la copia userà da sé quelli
                impostati adesso.
              </p>
              {sameRules ? (
                <Actions
                  busy={busy}
                  onCancel={() => setPanel(null)}
                  confirm="Duplica"
                  onConfirm={() => duplicate(false)}
                />
              ) : (
                <>
                  {/* La scelta compare solo quando c'è davvero: se le regole
                      non sono cambiate, chiedere sarebbe rumore. */}
                  <p className="text-brass mt-2.5 text-[0.6875rem]">
                    Le regole sono cambiate da allora. Con quali riparti?
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      onClick={() => duplicate(false)}
                      disabled={busy}
                      className="bg-ink text-page rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                    >
                      Quelle dell&apos;originale (v{entry.formatVersion})
                    </button>
                    <button
                      onClick={() => duplicate(true)}
                      disabled={busy}
                      className="border-line-strong hover:bg-raised rounded-md border px-3 py-1.5 text-xs disabled:opacity-40"
                    >
                      Le correnti (v{currentFormatVersion})
                    </button>
                    <button
                      onClick={() => setPanel(null)}
                      className="text-ink-dim hover:text-ink px-2 text-xs"
                    >
                      Annulla
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {panel === "delete" && (
            <>
              <p className="text-ink text-sm">
                Elimino <strong>{entry.title ?? entry.topic}</strong> e i suoi{" "}
                {entry.turnCount} turni.
              </p>
              <p className="text-live mt-1.5 text-[0.6875rem] leading-snug">
                Questa cancella davvero, a differenza di rigenera e riavvolgi:
                non resta niente nel database e non si può annullare.
              </p>
              <Actions
                busy={busy}
                onCancel={() => setPanel(null)}
                confirm="Elimina"
                onConfirm={remove}
                danger
              />
            </>
          )}

          {error && <p className="text-live mt-2 text-xs">{error}</p>}
        </div>
      )}
    </li>
  );
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`hover:bg-panel block w-full px-3 py-1.5 text-left text-sm transition-colors ${
        danger ? "text-live" : "text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function Actions({
  busy,
  onCancel,
  onConfirm,
  confirm,
  danger,
  disabled,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  confirm: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      <button
        onClick={onConfirm}
        disabled={busy || disabled}
        className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-transform active:scale-[0.97] disabled:opacity-40 ${
          danger ? "bg-live text-page" : "bg-ink text-page"
        }`}
      >
        {busy ? "…" : confirm}
      </button>
      <button
        onClick={onCancel}
        className="text-ink-dim hover:text-ink px-2 text-sm transition-colors"
      >
        Annulla
      </button>
    </div>
  );
}
