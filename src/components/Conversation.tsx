"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/Markdown";

const MAX_AUTO_TURNS = 5;
const PHASES = ["apertura", "dibattito", "chiusura"] as const;

export interface Guest {
  id: string;
  name: string;
  emoji: string;
  color: string;
}
interface Turn {
  id: string;
  ordinal: number;
  authorType: "host" | "guest" | "system";
  guestId: string | null;
  content: string;
  status: "pending" | "ok" | "interrupted" | "error";
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  cacheWriteTokens: number | null;
  latencyMs: number | null;
}
export interface Episode {
  id: string;
  topic: string;
  brief: string;
  hostName: string;
  phase: (typeof PHASES)[number];
  status: "draft" | "live" | "paused" | "ended";
}
export interface Participant {
  guestId: string;
  role: string | null;
}

export interface ConversationData {
  episode: Episode;
  turns: Turn[];
  guests: Guest[];
  participants: Participant[];
  next: Participant | null;
}

const btnPrimary =
  "rounded-md bg-ink px-4 py-1.5 text-sm font-medium text-page transition-transform active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100";
const btnGhost =
  "rounded-md border border-line-strong px-3.5 py-1.5 text-sm text-ink transition-colors hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent";

export function Conversation({ initial }: { initial: ConversationData }) {
  const id = initial.episode.id;

  const [episode, setEpisode] = useState<Episode>(initial.episode);
  const [turns, setTurns] = useState<Turn[]>(initial.turns);
  const [guests] = useState<Guest[]>(initial.guests);
  const [participants] = useState<Participant[]>(initial.participants);
  const [next, setNext] = useState<Participant | null>(initial.next);

  const [live, setLive] = useState<{
    name: string;
    color: string;
    text: string;
  } | null>(null);
  const [auto, setAuto] = useState(false);
  const [hostDraft, setHostDraft] = useState("");
  /** Azione trattenuta perché c'è un intervento scritto ma non inviato. */
  const [pending, setPending] = useState<{
    label: string;
    run: () => void;
  } | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  /** Rewind proposto ma non ancora confermato. */
  const [rewind, setRewind] = useState<{
    turn: Turn;
    count: number;
    restores: boolean;
    overwritesDraft: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const autoCount = useRef(0);
  const busy = useRef(false);

  const guestById = useCallback(
    (gid: string | null) => guests.find((g) => g.id === gid),
    [guests],
  );

  const load = useCallback(async () => {
    const r = await fetch(`/api/episodes/${id}`);
    const d = await r.json();
    if (d.error) return setError(d.error);
    setEpisode(d.episode);
    setTurns(d.turns);
    setNext(d.next);
  }, [id]);

  const generate = useCallback(
    async (opts: { guestId?: string; regenerateTurnId?: string } = {}) => {
      if (busy.current) return;
      busy.current = true;
      setError(null);
      // La presa da rifare sparisce subito dalla trascrizione: resta nel
      // database, ma tenerla a schermo mentre arriva la sostituta confonde.
      if (opts.regenerateTurnId) setRegenerating(opts.regenerateTurnId);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch(`/api/episodes/${id}/turn`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(opts),
          signal: controller.signal,
        });
        if (!response.body) throw new Error("Nessuna risposta dal server");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const event = JSON.parse(line.slice(6));

            if (event.type === "start") {
              const g = guests.find((x) => x.id === event.guestId);
              setLive({
                name: event.guestName,
                color: g?.color ?? "#888",
                text: "",
              });
            } else if (event.type === "text") {
              setLive((l) => (l ? { ...l, text: l.text + event.text } : l));
            } else if (event.type === "error") {
              setError(event.message);
              setAuto(false);
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError(String(e));
      } finally {
        abortRef.current = null;
        setLive(null);
        setRegenerating(null);
        busy.current = false;
        await load();
      }
    },
    [id, guests, load],
  );

  // Giro automatico, con un tetto: dopo qualche turno senza chi modera la
  // conversazione si ferma da sola, così la sedia di chi modera resta occupata.
  useEffect(() => {
    if (!auto || live || busy.current) return;
    if (autoCount.current >= MAX_AUTO_TURNS) {
      setAuto(false);
      autoCount.current = 0;
      return;
    }
    const timer = setTimeout(() => {
      autoCount.current += 1;
      generate({});
    }, 400);
    return () => clearTimeout(timer);
  }, [auto, live, turns, generate]);

  async function patch(body: Record<string, unknown>) {
    const r = await fetch(`/api/episodes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (d.episode) setEpisode(d.episode);
    if (d.turns) setTurns(d.turns);
    if (d.next !== undefined) setNext(d.next);
  }

  async function sendHost() {
    const text = hostDraft.trim();
    if (!text) return;
    setHostDraft("");
    // Si accoda: se un ospite sta scrivendo, il suo turno ha già il proprio
    // posto e l'intervento di chi modera entra subito dopo.
    autoCount.current = 0;
    await patch({ hostMessage: text });
  }

  /**
   * Far ripartire il giro con un intervento scritto ma non inviato è un errore
   * silenzioso e irreversibile: la conversazione prosegue senza di te. Meglio
   * fermarsi e chiedere.
   */
  function guard(label: string, action: () => void) {
    if (hostDraft.trim()) setPending({ label, run: action });
    else action();
  }

  /** Dà la parola a un ospite: da lì il giro riprende dal successivo. */
  function giveFloor(guestId: string) {
    guard("dare la parola", () => {
      autoCount.current = 0;
      generate({ guestId });
    });
  }

  /** Rifà un turno: stesso ospite, stesso posto nel giro, senza vedere la presa scartata. */
  function regenerate(turnId: string) {
    guard("rigenera", () => generate({ regenerateTurnId: turnId }));
  }

  /**
   * Il rewind non chiede conferma per prudenza generica: la chiede perché da
   * un turno solo non si vede quanti ne porta via. Il numero è il punto.
   */
  function askRewind(turn: Turn) {
    const count = turns.filter(
      (t) => t.ordinal >= turn.ordinal && t.id !== regenerating,
    ).length;
    setRewind({
      turn,
      count,
      restores: turn.authorType === "host",
      overwritesDraft:
        turn.authorType === "host" && hostDraft.trim().length > 0,
    });
  }

  async function confirmRewind() {
    if (!rewind) return;
    const { turn, restores } = rewind;
    setRewind(null);
    autoCount.current = 0;
    setAuto(false);
    await patch({ rewindToTurnId: turn.id });
    // Come in Claude Code: riavvolgendo un proprio intervento lo si ritrova
    // nell'area di scrittura, perché il caso normale è volerlo riscrivere.
    if (restores) setHostDraft(turn.content);
  }

  const totals = turns.reduce(
    (acc, t) => ({
      in: acc.in + (t.inputTokens ?? 0),
      out: acc.out + (t.outputTokens ?? 0),
      cached: acc.cached + (t.cachedTokens ?? 0),
      written: acc.written + (t.cacheWriteTokens ?? 0),
    }),
    { in: 0, out: 0, cached: 0, written: 0 },
  );

  // I tre conteggi in ingresso sono disgiunti: letti dalla cache (un decimo del
  // prezzo), scritti in cache (un quarto in più, ma una volta sola) e nuovi a
  // prezzo pieno. La quota letta è la misura di quanto la cache sta lavorando.
  const promptTokens = totals.in + totals.cached + totals.written;
  const cacheShare = promptTokens
    ? Math.round((totals.cached / promptTokens) * 100)
    : 0;

  const speakingId = live ? guests.find((g) => g.name === live.name)?.id : null;

  return (
    <div className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-6 pt-8 pb-0 lg:grid-cols-[minmax(0,1fr)_264px]">
      <main className="flex min-w-0 flex-col">
        <header className="mb-10">
          <div className="mb-3 flex items-center gap-3">
            <StatusLine live={!!live} auto={auto} />
            <span className="text-ink-faint font-mono text-[0.6875rem] tracking-[0.12em]">
              {turns.filter((t) => t.authorType === "guest").length} turni
            </span>
          </div>
          <h1 className="font-serif max-w-[36rem] text-[1.75rem] leading-tight tracking-tight text-balance">
            {episode.topic}
          </h1>
          {episode.brief && (
            <details className="group mt-3 max-w-[36rem]">
              <summary className="text-ink-dim hover:text-ink cursor-pointer list-none text-xs transition-colors select-none [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Brief ▸</span>
                <span className="hidden group-open:inline">Brief ▾</span>
              </summary>
              <div className="border-line text-ink-dim mt-2 border-l pl-4 text-sm leading-relaxed whitespace-pre-wrap">
                {episode.brief}
              </div>
            </details>
          )}
        </header>

        {/* La colonna del parlato è tarata sulla lettura, non sulla larghezza
            disponibile: oltre le ~70 battute l'occhio perde la riga. */}
        <div className="max-w-[36rem] space-y-8">
          {turns
            .filter((turn) => turn.id !== regenerating)
            .map((turn) => {
              const guest = guestById(turn.guestId);
              const isHost = turn.authorType === "host";
              const isDirective = turn.authorType === "system";

              // Un'indicazione di chi modera è un atto di conduzione, non un
              // intervento: si vede in trascrizione — serve a ricostruire come
              // è andata — ma non si legge come una voce in più al tavolo.
              if (isDirective) {
                return (
                  <div
                    key={turn.id}
                    className="animate-rise flex items-center gap-3 py-1"
                  >
                    {/* Con una direttiva lunga i filetti verrebbero schiacciati
                        a zero e l'indicazione perderebbe la sua forma: il
                        minimo li tiene visibili comunque. */}
                    <span className="bg-line h-px min-w-6 flex-1" />
                    <span className="text-ink-faint font-mono text-[0.6875rem] tracking-[0.08em]">
                      moderazione · {turn.content}
                    </span>
                    {/* Con una direttiva lunga i filetti verrebbero schiacciati
                        a zero e l'indicazione perderebbe la sua forma: il
                        minimo li tiene visibili comunque. */}
                    <span className="bg-line h-px min-w-6 flex-1" />
                  </div>
                );
              }

              const color = isHost ? "#e3b23c" : (guest?.color ?? "#8a8378");

              return (
                <article
                  key={turn.id}
                  data-guest
                  style={{ "--guest": color } as React.CSSProperties}
                  className="animate-rise group border-l-2 pl-5 guest-rule"
                >
                  <div className="mb-2 flex items-center gap-2.5">
                    <span className="guest-ink font-mono text-[0.6875rem] tracking-[0.1em] uppercase">
                      {isHost ? episode.hostName : (guest?.name ?? "Ospite")}
                    </span>
                    {turn.status === "interrupted" && (
                      <span className="text-brass font-mono text-[0.6875rem]">
                        interrotto
                      </span>
                    )}
                    <span className="text-ink-faint ml-auto flex items-center gap-2.5 font-mono text-[0.6875rem] opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                      {turn.outputTokens !== null && (
                        <span>
                          {turn.outputTokens} tok · {turn.latencyMs} ms
                        </span>
                      )}
                    </span>
                    <button
                      onClick={() => askRewind(turn)}
                      disabled={!!live}
                      title="Riavvolge qui: questo turno e tutti i successivi escono di trascrizione"
                      className="text-ink-faint hover:text-ink font-mono text-[0.6875rem] opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 disabled:opacity-30"
                    >
                      ↩ riavvolgi
                    </button>
                    {!isHost && (
                      <button
                        onClick={() => regenerate(turn.id)}
                        disabled={!!live}
                        // Sempre visibile su un turno fallito: lì serve davvero.
                        className={`hover:text-ink font-mono text-[0.6875rem] transition-opacity disabled:opacity-30 ${
                          turn.status === "error"
                            ? "text-live"
                            : "text-ink-faint opacity-0 group-hover:opacity-100 focus:opacity-100"
                        }`}
                      >
                        ↻ rigenera
                      </button>
                    )}
                  </div>
                  {turn.status === "error" ? (
                    <p className="text-live text-sm">{turn.content}</p>
                  ) : (
                    <Markdown>{turn.content}</Markdown>
                  )}
                </article>
              );
            })}

          {live && (
            <article
              data-guest
              style={{ "--guest": live.color } as React.CSSProperties}
              className="animate-rise border-l-2 pl-5 guest-rule"
            >
              <div className="mb-2 flex items-center gap-2.5">
                <span className="guest-ink font-mono text-[0.6875rem] tracking-[0.1em] uppercase">
                  {live.name}
                </span>
                <Bars color={live.color} />
              </div>
              <Markdown>{live.text}</Markdown>
              <span
                className="animate-caret bg-ink-dim -mt-4 inline-block h-4 w-[2px] align-middle"
                aria-label="sta parlando"
              />
            </article>
          )}

          {turns.length === 0 && !live && (
            <p className="text-ink-faint text-sm">
              La conversazione non è ancora cominciata.
            </p>
          )}
        </div>

        {error && (
          <p className="border-live/40 bg-live/10 text-live mt-8 max-w-[36rem] rounded-md border px-4 py-2.5 text-sm">
            {error}
          </p>
        )}

        {/* I comandi restano sotto le mani mentre la trascrizione scorre. */}
        <div className="border-line bg-page/90 sticky bottom-0 mt-10 border-t pt-4 pb-6 backdrop-blur-md">
          {rewind && (
            <div className="border-line-strong bg-panel mb-3 max-w-[36rem] rounded-lg border px-4 py-3 text-sm">
              <p className="text-ink">
                Riavvolgo a prima di questo turno:{" "}
                <strong>
                  {rewind.count === 1
                    ? "1 turno esce"
                    : `${rewind.count} turni escono`}
                </strong>{" "}
                dalla trascrizione.
              </p>
              <p className="text-ink-dim mt-1 text-xs">
                Restano nel database e non vengono cancellati, ma gli ospiti non
                li vedranno più.
                {rewind.restores &&
                  " Il tuo intervento torna nell'area di scrittura."}
                {rewind.overwritesDraft && (
                  <span className="text-brass">
                    {" "}
                    Sostituisce quello che hai scritto e non inviato.
                  </span>
                )}
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button onClick={confirmRewind} className={btnPrimary}>
                  Riavvolgi
                </button>
                <button
                  onClick={() => setRewind(null)}
                  className="text-ink-dim hover:text-ink px-2 text-sm transition-colors"
                >
                  Annulla
                </button>
              </div>
            </div>
          )}

          {pending && (
            <div className="border-brass/50 bg-brass/10 mb-3 max-w-[36rem] rounded-lg border px-4 py-3 text-sm">
              <p className="text-ink">
                Hai un intervento scritto ma <strong>non inviato</strong>. Se
                prosegui senza inviarlo, gli ospiti non lo leggeranno.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button
                  onClick={async () => {
                    const action = pending.run;
                    setPending(null);
                    await sendHost();
                    action();
                  }}
                  className={btnPrimary}
                >
                  Invia, poi {pending.label}
                </button>
                <button
                  onClick={() => {
                    const action = pending.run;
                    setPending(null);
                    action();
                  }}
                  className={btnGhost}
                >
                  Prosegui senza inviare
                </button>
                <button
                  onClick={() => setPending(null)}
                  className="text-ink-dim hover:text-ink px-2 text-sm transition-colors"
                >
                  Annulla
                </button>
              </div>
            </div>
          )}

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => guard("vai avanti", () => generate({}))}
              disabled={!!live}
              className={btnPrimary}
            >
              Avanti
            </button>
            <button
              onClick={() =>
                // La pausa non ha bisogno di conferma: ferma, non prosegue.
                auto
                  ? setAuto(false)
                  : guard("avvia il giro", () => {
                      autoCount.current = 0;
                      setAuto(true);
                    })
              }
              className={
                auto
                  ? "border-brass text-brass hover:bg-brass/10 rounded-md border px-3.5 py-1.5 text-sm transition-colors"
                  : btnGhost
              }
            >
              {auto ? "Pausa" : "Giro automatico"}
            </button>
            <button
              onClick={() => abortRef.current?.abort()}
              disabled={!live}
              className="border-line-strong text-ink rounded-md border px-3.5 py-1.5 text-sm transition-colors hover:border-live hover:text-live disabled:opacity-40 disabled:hover:border-line-strong disabled:hover:text-ink"
            >
              Ferma ora
            </button>
            {next && !live && (
              <span className="text-ink-faint ml-1 font-mono text-[0.6875rem]">
                tocca a {guestById(next.guestId)?.name}
              </span>
            )}
          </div>

          <div className="focus-within:border-line-strong border-line bg-panel flex max-w-[36rem] items-end gap-2 rounded-lg border p-2 transition-colors">
            <textarea
              className="text-ink placeholder:text-ink-faint min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none"
              rows={1}
              placeholder={`Intervieni come ${episode.hostName}…`}
              value={hostDraft}
              onChange={(e) => setHostDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendHost();
              }}
            />
            <button
              onClick={sendHost}
              disabled={!hostDraft.trim()}
              className={btnPrimary}
            >
              Invia
            </button>
          </div>
          <p className="text-ink-faint mt-1.5 px-2 font-mono text-[0.625rem]">
            ⌘↵ per inviare · si accoda al turno in corso
          </p>
        </div>
      </main>

      <aside className="lg:sticky lg:top-20 lg:self-start lg:pb-8">
        <Panel title="Al tavolo">
          <ul className="space-y-1">
            {participants.map((c) => {
              const g = guestById(c.guestId);
              const isNext = next?.guestId === c.guestId;
              const isSpeaking = speakingId === c.guestId;
              return (
                <li
                  key={c.guestId}
                  data-guest
                  style={{ "--guest": g?.color } as React.CSSProperties}
                  className={`group flex gap-2.5 rounded-md p-2 transition-colors ${
                    isSpeaking ? "guest-wash" : "hover:bg-raised"
                  }`}
                >
                  {/* Il canale: come su un mixer, il colore dell'ospite è una
                      barra verticale, e si accende quando ha la parola. */}
                  <span
                    className="w-[3px] shrink-0 rounded-full transition-opacity"
                    style={{
                      background: g?.color,
                      opacity: isSpeaking || isNext ? 1 : 0.35,
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="guest-ink truncate text-[0.8125rem] font-medium">
                        {g?.name}
                      </span>
                      {isSpeaking ? (
                        <Bars color={g?.color ?? "#888"} />
                      ) : isNext ? (
                        <span className="text-ink-faint font-mono text-[0.625rem]">
                          di turno
                        </span>
                      ) : null}
                    </div>
                    {c.role && (
                      <p className="text-ink-faint mt-0.5 text-[0.6875rem] leading-snug">
                        {c.role}
                      </p>
                    )}
                    <button
                      onClick={() => giveFloor(c.guestId)}
                      disabled={!!live}
                      className="text-ink-faint hover:text-ink mt-1 font-mono text-[0.625rem] opacity-0 transition group-hover:opacity-100 focus:opacity-100 disabled:opacity-30"
                    >
                      dai la parola →
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="text-ink-faint mt-2 text-[0.6875rem] leading-snug">
            Dando la parola fuori turno, il giro riprende dall&apos;ospite
            successivo a quello scelto.
          </p>
        </Panel>

        <Panel title="Fase">
          {/* Tre stati fissi e mutuamente esclusivi: un segmentato li mostra
              tutti e tre, un menu a tendina ne nasconde due. */}
          <div className="border-line bg-panel grid grid-cols-3 gap-0.5 rounded-md border p-0.5">
            {PHASES.map((p) => (
              <button
                key={p}
                onClick={() => patch({ phase: p })}
                aria-pressed={episode.phase === p}
                className={`rounded-[5px] py-1.5 text-[0.6875rem] transition-colors ${
                  episode.phase === p
                    ? "bg-raised text-ink"
                    : "text-ink-faint hover:text-ink-dim"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Consumo">
          <div className="flex items-baseline gap-1.5">
            <span className="font-mono text-2xl tracking-tight">
              {compact(promptTokens)}
            </span>
            <span className="text-ink-faint font-mono text-[0.6875rem]">
              token in
            </span>
          </div>
          <div className="text-ink-dim mt-0.5 font-mono text-[0.6875rem]">
            {totals.out.toLocaleString("it")} out
          </div>

          {/* La quota letta dalla cache è l'unico numero che dice se il costo
              sta crescendo lineare o quadratico: merita una barra, non una riga. */}
          <div
            className="mt-4"
            title="I token letti dalla cache costano circa un decimo."
          >
            <div className="text-ink-faint mb-1.5 flex justify-between font-mono text-[0.625rem] tracking-[0.08em] uppercase">
              <span>cache</span>
              <span className="text-good">{cacheShare}%</span>
            </div>
            <div className="bg-raised h-1 overflow-hidden rounded-full">
              <div
                className="bg-good h-full rounded-full transition-[width] duration-500"
                style={{ width: `${cacheShare}%` }}
              />
            </div>
            <p className="text-ink-faint mt-1.5 font-mono text-[0.625rem]">
              {totals.cached.toLocaleString("it")} letti
            </p>
          </div>
        </Panel>
      </aside>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-line border-b py-5 first:pt-0 last:border-b-0">
      <h2 className="text-ink-faint mb-3 font-mono text-[0.625rem] tracking-[0.16em] uppercase">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Lo stato della conversazione in una riga: in corso, in giro, o ferma. */
function StatusLine({ live, auto }: { live: boolean; auto: boolean }) {
  if (live)
    return (
      <span className="text-live flex items-center gap-2 font-mono text-[0.6875rem] tracking-[0.16em] uppercase">
        <span className="bg-live animate-live size-1.5 rounded-full" />
        in corso
      </span>
    );
  if (auto)
    return (
      <span className="text-brass flex items-center gap-2 font-mono text-[0.6875rem] tracking-[0.16em] uppercase">
        <span className="bg-brass size-1.5 rounded-full" />
        giro automatico
      </span>
    );
  return (
    <span className="text-ink-faint flex items-center gap-2 font-mono text-[0.6875rem] tracking-[0.16em] uppercase">
      <span className="bg-ink-faint size-1.5 rounded-full" />
      in pausa
    </span>
  );
}

/** Segnala chi sta parlando in questo momento. */
function Bars({ color }: { color: string }) {
  return (
    <span className="flex h-2.5 items-center gap-[2px]" aria-hidden>
      {[0, 0.25, 0.5].map((delay) => (
        <span
          key={delay}
          className="animate-[bars_0.9s_ease-in-out_infinite] w-[2px] rounded-full"
          style={{
            background: color,
            height: "100%",
            animationDelay: `${delay}s`,
          }}
        />
      ))}
    </span>
  );
}

/** 41.200 → 41,2k. In un pannello di strumenti la cifra tonda batte l'esatta. */
function compact(n: number) {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1).replace(".", ",")}k`;
}
