"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type Phase = "apertura" | "dibattito" | "chiusura";

export interface FormatData {
  id: string;
  name: string;
  body: string;
  version: number;
  phases: Record<Phase, string>;
}

/** Presente solo quando si sta guardando le regole di una conversazione. */
export interface PinnedTo {
  episodeId: string;
  topic: string;
  hostName: string;
  isCurrent: boolean;
}

export interface GuestOption {
  id: string;
  name: string;
  color: string;
  emoji: string;
}

const PHASES: Phase[] = ["apertura", "dibattito", "chiusura"];

const PLACEHOLDERS = [
  ["{{show_name}}", "il nome che hai dato a questo spazio"],
  ["{{guest_name}}", "il nome pubblico dell'ospite di turno"],
  ["{{target_words}}", "la lunghezza target configurata per quell'ospite"],
];

export interface Settings {
  showName: string;
  hostName: string;
}

export function FormatEditor({
  format,
  guests,
  defaults,
  settings,
  pinnedTo,
}: {
  format: FormatData;
  guests: GuestOption[];
  defaults: { body: string; phases: Record<Phase, string> };
  settings: Settings;
  pinnedTo?: PinnedTo;
}) {
  const router = useRouter();
  // Le regole di una conversazione sono un documento storico: si guardano e si
  // possono riportare in uso, ma non si modificano dove sono. Cambiarle
  // significherebbe riscrivere il prompt sotto una conversazione già avvenuta.
  const readOnly = !!pinnedTo;

  const [body, setBody] = useState(format.body);
  const [phases, setPhases] = useState<Record<Phase, string>>(format.phases);
  const [showName, setShowName] = useState(settings.showName);
  const [hostName, setHostName] = useState(settings.hostName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  /** Conferme trattenute: salvare crea una versione, adottare ne sposta una. */
  const [confirming, setConfirming] = useState<"save" | "adopt" | null>(null);

  const [previewGuest, setPreviewGuest] = useState(guests[0]?.id ?? "");
  const [previewPhase, setPreviewPhase] = useState<Phase>("apertura");
  const [preview, setPreview] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const dirty =
    body !== format.body ||
    showName !== settings.showName ||
    hostName !== settings.hostName ||
    PHASES.some((p) => phases[p] !== format.phases[p]);

  async function save() {
    setConfirming(null);
    setSaving(true);
    await Promise.all([
      fetch("/api/format", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body, phases }),
      }),
      fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ showName, hostName }),
      }),
    ]);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    // La versione è cambiata: il numero in testata verrebbe da dati vecchi.
    router.refresh();
  }

  /** Riporta in uso una versione passata: sposta il puntatore, non duplica. */
  async function adopt() {
    setConfirming(null);
    setSaving(true);
    await fetch("/api/format", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ adoptFormatId: format.id }),
    });
    setSaving(false);
    router.push("/config");
  }

  async function runPreview() {
    setPreviewing(true);
    const r = await fetch("/api/format/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Si manda il testo dell'editor, non quello salvato: l'anteprima serve
      // proprio a valutare una modifica prima di confermarla.
      body: JSON.stringify({
        guestId: previewGuest,
        phase: previewPhase,
        body,
        phases,
      }),
    });
    const d = await r.json();
    setPreview(d.preview ?? d.error ?? "");
    setPreviewing(false);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-14">
      <header className="mb-10">
        <p className="text-ink-faint font-mono text-xs tracking-[0.16em] uppercase">
          Configurazione
        </p>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-4xl tracking-tight">Regole</h1>
          <span className="border-line text-ink-dim rounded border px-2 py-0.5 font-mono text-[0.6875rem]">
            versione {format.version}
          </span>
          {readOnly && (
            <span className="text-brass font-mono text-[0.6875rem] tracking-[0.1em] uppercase">
              sola lettura
            </span>
          )}
        </div>

        {readOnly ? (
          <div className="border-line bg-panel mt-4 max-w-xl rounded-lg border px-4 py-3">
            <p className="text-ink text-sm">
              Le regole con cui è stata condotta{" "}
              <Link
                href={`/episodes/${pinnedTo.episodeId}`}
                className="text-brass underline underline-offset-2"
              >
                {pinnedTo.topic}
              </Link>
              .
            </p>
            <p className="text-ink-dim mt-1.5 text-xs">
              Non si modificano: cambiarle qui riscriverebbe il prompt sotto una
              conversazione già avvenuta, e la trascrizione smetterebbe di
              corrispondere a ciò che l&apos;ha prodotta. Moderava{" "}
              {pinnedTo.hostName}.
              {pinnedTo.isCurrent &&
                " Questa è anche la versione corrente, quella che ricevono le conversazioni nuove."}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {!pinnedTo.isCurrent && (
                <button
                  onClick={() => setConfirming("adopt")}
                  disabled={saving}
                  className="bg-ink text-page rounded-md px-4 py-1.5 text-sm font-medium transition-transform active:scale-[0.97] disabled:opacity-40"
                >
                  Usa come correnti
                </button>
              )}
              <Link
                href="/config"
                className="text-ink-dim hover:text-ink text-sm transition-colors"
              >
                Vai alle regole correnti →
              </Link>
            </div>
          </div>
        ) : (
          <p className="text-ink-dim mt-2 max-w-xl text-sm">
            Come si sta a questo tavolo: valgono uguali per tutti gli ospiti. La
            persona del singolo ospite si configura invece nella scheda Ospiti.
            Ogni salvataggio crea una versione nuova; le conversazioni già
            avviate restano su quella che avevano.
          </p>
        )}

        {confirming === "adopt" && pinnedTo && (
          <div className="border-brass/50 bg-brass/10 mt-3 max-w-xl rounded-lg border px-4 py-3 text-sm">
            <p className="text-ink">
              La versione {format.version} torna a essere quella{" "}
              <strong>corrente</strong>.
            </p>
            <p className="text-ink-dim mt-1 text-xs">
              La riceveranno le conversazioni create da adesso. Quelle già
              esistenti, compresa questa, non si spostano: restano agganciate
              alla versione con cui sono state condotte. Nessuna versione viene
              cancellata.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                onClick={adopt}
                className="bg-ink text-page rounded-md px-4 py-1.5 text-sm font-medium transition-transform active:scale-[0.97]"
              >
                Usa come correnti
              </button>
              <button
                onClick={() => setConfirming(null)}
                className="text-ink-dim hover:text-ink px-2 text-sm transition-colors"
              >
                Annulla
              </button>
            </div>
          </div>
        )}
      </header>

      <div className="grid gap-10 lg:grid-cols-2">
        <div className="space-y-8">
          {/* Nome dello spazio e di chi modera sono impostazioni globali, non
              versionate: non appartengono alle regole di una conversazione e
              non hanno senso nella vista storica. */}
          <section className={readOnly ? "hidden" : undefined}>
            <h2 className="mb-1 text-sm font-medium">Generale</h2>
            <p className="text-ink-dim mb-3 text-xs">
              Valgono per tutte le conversazioni. Quelle già avvenute
              conservano il nome di chi moderava al momento: cambiarlo qui non
              riscrive la storia.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                {/* Altezza fissa su entrambe le etichette: la pastiglia del
                    segnaposto alzerebbe la riga solo qui, e i due campi
                    affiancati partirebbero da quote diverse. */}
                <span className="text-ink-dim mb-1.5 flex h-5 items-center gap-1.5 text-xs">
                  Come si chiama questo spazio <Chip>{"{{show_name}}"}</Chip>
                </span>
                <input
                  className={input}
                  value={showName}
                  onChange={(e) => setShowName(e.target.value)}
                />
              </label>
              <label className="block">
                <span className="text-ink-dim mb-1.5 flex h-5 items-center text-xs">
                  Nome di chi modera
                </span>
                <input
                  className={input}
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                />
              </label>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium">Il prompt condiviso</h2>
              {!readOnly && (
                <button
                  onClick={() => setBody(defaults.body)}
                  className="text-ink-faint hover:text-ink text-xs transition-colors"
                >
                  ripristina il predefinito
                </button>
              )}
            </div>
            <CodeEditor value={body} onChange={setBody} readOnly={readOnly} />
            <div className="mt-3 space-y-1">
              <p className="text-ink-faint text-[0.6875rem]">
                Segnaposto sostituiti a ogni turno:
              </p>
              {PLACEHOLDERS.map(([token, meaning]) => (
                <p key={token} className="text-ink-faint text-[0.6875rem]">
                  <Chip>{token}</Chip> {meaning}
                </p>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-1 text-sm font-medium">Istruzioni di fase</h2>
            <p className="text-ink-dim mb-3 text-xs">
              Iniettate in coda al prompt secondo la fase della conversazione. È il
              motivo per cui un ospite che sa di essere in chiusura scrive
              diversamente da uno che crede di essere all&apos;inizio.
            </p>
            <div className="space-y-3">
              {PHASES.map((p) => (
                <label key={p} className="block">
                  <span className="text-ink-faint mb-1.5 block font-mono text-[0.625rem] tracking-[0.12em] uppercase">
                    {p}
                  </span>
                  <textarea
                    className={`${input} min-h-16 leading-relaxed ${
                      readOnly ? "cursor-default" : ""
                    }`}
                    value={phases[p] ?? ""}
                    readOnly={readOnly}
                    onChange={(e) =>
                      setPhases((s) => ({ ...s, [p]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </div>
            {!readOnly && (
              <button
                onClick={() => setPhases(defaults.phases)}
                className="text-ink-faint hover:text-ink mt-2 text-xs transition-colors"
              >
                ripristina i predefiniti
              </button>
            )}
          </section>

          {!readOnly && (
            <div className="border-line border-t pt-5">
              {confirming === "save" && (
                <div className="border-brass/50 bg-brass/10 mb-3 rounded-lg border px-4 py-3 text-sm">
                  <p className="text-ink">
                    Salvando crei la{" "}
                    <strong>versione {format.version + 1}</strong>, che diventa
                    quella corrente.
                  </p>
                  <p className="text-ink-dim mt-1 text-xs">
                    La riceveranno le conversazioni create da adesso. Quelle già
                    avviate restano sulla versione con cui sono partite, e
                    continueranno a usarla fino alla fine — nessun prompt viene
                    riscritto all&apos;indietro. La versione {format.version}
                    &nbsp;resta consultabile dalle conversazioni che la usano.
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    <button
                      onClick={save}
                      className="bg-ink text-page rounded-md px-4 py-1.5 text-sm font-medium transition-transform active:scale-[0.97]"
                    >
                      Crea la versione {format.version + 1}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="text-ink-dim hover:text-ink px-2 text-sm transition-colors"
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setConfirming("save")}
                  disabled={saving || !dirty}
                  className="bg-ink text-page rounded-md px-4 py-1.5 text-sm font-medium transition-transform active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100"
                >
                  {saving ? "Salvo…" : "Salva"}
                </button>
                {saved && (
                  <span className="text-good font-mono text-[0.6875rem]">
                    salvato
                  </span>
                )}
                {dirty && !saved && (
                  <span className="text-brass flex items-center gap-1.5 font-mono text-[0.6875rem]">
                    <span className="bg-brass size-1.5 rounded-full" />
                    modifiche non salvate
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* L'anteprima è il prompt come arriva davvero all'ospite: si presenta
            come una console di sola lettura, non come un altro campo da riempire. */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <h2 className="mb-1 text-sm font-medium">Anteprima del prompt</h2>
          <p className="text-ink-dim mb-3 text-xs">
            I tre strati montati come li riceverà davvero l&apos;ospite, su una
            conversazione d&apos;esempio.
          </p>

          <div className="border-line bg-panel overflow-hidden rounded-lg border">
            <div className="border-line bg-raised flex flex-wrap items-center gap-2 border-b px-3 py-2">
              <select
                className={selectSmall}
                value={previewGuest}
                onChange={(e) => setPreviewGuest(e.target.value)}
              >
                {guests.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <select
                className={selectSmall}
                value={previewPhase}
                onChange={(e) => setPreviewPhase(e.target.value as Phase)}
              >
                {PHASES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button
                onClick={runPreview}
                disabled={previewing}
                className="border-line-strong hover:bg-panel ml-auto rounded border px-3 py-1 text-xs transition-colors disabled:opacity-40"
              >
                {previewing ? "Compongo…" : "Componi"}
              </button>
            </div>
            <pre className="text-ink-dim h-[34rem] overflow-auto p-4 font-mono text-[0.6875rem] leading-relaxed whitespace-pre-wrap">
              {preview ?? (
                <span className="text-ink-faint">
                  Premi «Componi» per vedere il prompt che riceverà
                  l&apos;ospite.
                </span>
              )}
            </pre>
          </div>
        </div>
      </div>
    </main>
  );
}

/**
 * Editor del format con i segnaposto evidenziati. È una textarea trasparente
 * sopra una copia colorata dello stesso testo: l'unico modo di avere insieme
 * la modifica nativa e l'evidenziazione. Metriche e padding vanno tenuti
 * identici fra i due strati, altrimenti il testo si sdoppia.
 */
function CodeEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
}) {
  const mirror = useRef<HTMLPreElement>(null);
  const shared =
    "p-3 font-mono text-[0.6875rem] leading-[1.6] whitespace-pre-wrap break-words";

  return (
    <div className="border-line bg-panel focus-within:border-line-strong relative h-[26rem] overflow-hidden rounded-lg border transition-colors">
      <pre
        ref={mirror}
        aria-hidden="true"
        className={`${shared} text-ink pointer-events-none absolute inset-0 overflow-hidden`}
      >
        {highlight(value)}
      </pre>
      <textarea
        value={value}
        readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => {
          if (mirror.current)
            mirror.current.scrollTop = e.currentTarget.scrollTop;
        }}
        spellCheck={false}
        // In sola lettura il cursore sparisce ma il testo resta selezionabile:
        // serve a copiarlo, che è la cosa sensata da farci.
        className={`${shared} absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent text-transparent outline-none ${
          readOnly ? "caret-transparent" : "caret-white"
        }`}
      />
    </div>
  );
}

/** Spezza il testo sui {{segnaposto}} e li restituisce in ottone. */
function highlight(text: string) {
  return text.split(/(\{\{\w+\}\})/g).map((part, i) =>
    /^\{\{\w+\}\}$/.test(part) ? (
      <span key={i} className="text-brass">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <code className="border-line text-brass rounded border px-1 py-0.5 font-mono text-[0.625rem]">
      {children}
    </code>
  );
}

const input =
  "w-full rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint outline-none transition-colors focus:border-line-strong";

const selectSmall =
  "rounded border border-line-strong bg-panel px-2 py-1 text-xs text-ink outline-none";
