"use client";

import { useCallback, useEffect, useState } from "react";
import type { ModelInfo } from "@/lib/providers/types";

export interface Guest {
  id: string;
  name: string;
  provider: "anthropic" | "openai" | "google";
  model: string;
  keyRef: string;
  persona: string;
  targetWords: number;
  maxTokens: number;
  params: { temperature?: number; effort?: string };
  color: string;
  emoji: string;
}

interface TestResult {
  ok: boolean;
  text?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number };
  latencyMs?: number;
  error?: string;
}

export function GuestsEditor({ guests }: { guests: Guest[] }) {
  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-14">
      <header className="mb-10">
        <p className="text-ink-faint font-mono text-xs tracking-[0.16em] uppercase">
          Configurazione
        </p>
        <h1 className="font-serif mt-2 text-4xl tracking-tight">Ospiti</h1>
        <p className="text-ink-dim mt-2 max-w-lg text-sm">
          Un ospite per famiglia. Il modello è configurazione: cambiarlo non
          cambia chi è l&apos;ospite in trascrizione.
        </p>
      </header>

      <div className="space-y-4">
        {guests.map((g) => (
          <GuestCard key={g.id} guest={g} />
        ))}
      </div>
    </main>
  );
}

function GuestCard({ guest }: { guest: Guest }) {
  const [draft, setDraft] = useState<Guest>(guest);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);

  useEffect(() => {
    fetch(`/api/models?provider=${guest.provider}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setModelsError(d.error) : setModels(d.models)))
      .catch((e) => setModelsError(String(e)));
  }, [guest.provider]);

  const caps = models?.find((m) => m.id === draft.model)?.capabilities;

  const patch = useCallback((changes: Partial<Guest>) => {
    setDraft((d) => ({ ...d, ...changes }));
    setSaved(false);
  }, []);

  async function save() {
    setSaving(true);
    await fetch("/api/guests", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: draft.provider,
        name: draft.name,
        model: draft.model,
        persona: draft.persona,
        targetWords: draft.targetWords,
        maxTokens: draft.maxTokens,
        params: draft.params,
      }),
    });
    setSaving(false);
    setSaved(true);
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    const r = await fetch("/api/guests/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: draft.provider,
        model: draft.model,
        params: draft.params,
        maxTokens: draft.maxTokens,
      }),
    });
    setTest((await r.json()) as TestResult);
    setTesting(false);
  }

  return (
    <section
      data-guest
      style={{ "--guest": draft.color } as React.CSSProperties}
      className="border-line bg-panel overflow-hidden rounded-xl border"
    >
      {/* Il colore dell'ospite regge l'intestazione: in un elenco di tre schede
          identiche è l'unica cosa che si riconosce senza leggere. */}
      <div className="border-line guest-wash flex items-center gap-3 border-b px-5 py-3.5">
        <span
          className="h-6 w-[3px] shrink-0 rounded-full"
          style={{ background: draft.color }}
        />
        <h2 className="guest-ink text-[0.9375rem] font-medium">{draft.name}</h2>
        <span className="text-ink-faint font-mono text-[0.6875rem]">
          {draft.provider}
        </span>
        <span className="ml-auto flex items-center gap-2.5">
          <span
            className={`font-mono text-[0.6875rem] ${
              draft.model ? "text-good" : "text-brass"
            }`}
          >
            {draft.model || "nessun modello"}
          </span>
          <code className="border-line text-ink-faint rounded border px-1.5 py-0.5 font-mono text-[0.625rem]">
            {draft.keyRef}
          </code>
        </span>
      </div>

      <div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
        <Field label="Modello">
          {modelsError ? (
            <p className="text-live text-sm">{modelsError}</p>
          ) : (
            <select
              className={inputClass}
              value={draft.model}
              disabled={!models}
              onChange={(e) => patch({ model: e.target.value })}
            >
              <option value="">
                {models ? "— scegli un modello —" : "caricamento…"}
              </option>
              {models?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label === m.id ? m.id : `${m.label} — ${m.id}`}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label="Nome pubblico">
          <input
            className={inputClass}
            value={draft.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Field>

        {/* I controlli disponibili dipendono dal modello scelto, non dalla
            famiglia: mandare `temperature` a un modello che l'ha rimossa
            restituisce un errore, non viene ignorata. */}
        {caps?.effort && (
          <Field
            label="Effort"
            hint="Quanto ragiona prima di rispondere. Alza il costo e la latenza."
          >
            <select
              className={inputClass}
              value={draft.params.effort ?? "medium"}
              onChange={(e) =>
                patch({ params: { ...draft.params, effort: e.target.value } })
              }
            >
              {caps.effort.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
        )}

        {caps?.temperature && (
          <Field label="Temperatura">
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                className="accent-brass h-9 flex-1"
                value={draft.params.temperature ?? 1}
                onChange={(e) =>
                  patch({
                    params: {
                      ...draft.params,
                      temperature: Number(e.target.value),
                    },
                  })
                }
              />
              <span className="text-ink w-8 text-right font-mono text-xs">
                {(draft.params.temperature ?? 1).toFixed(1)}
              </span>
            </div>
          </Field>
        )}

        <Field
          label="Lunghezza target (parole)"
          hint="Finisce nel prompt. È questo che governa la lunghezza."
        >
          <input
            type="number"
            className={inputClass}
            value={draft.targetWords}
            onChange={(e) => patch({ targetWords: Number(e.target.value) })}
          />
        </Field>

        <Field
          label="Max tokens"
          hint="Rete di sicurezza tecnica. Sui modelli che ragionano il tetto copre anche il ragionamento: tienilo largo."
        >
          <input
            type="number"
            className={inputClass}
            value={draft.maxTokens}
            onChange={(e) => patch({ maxTokens: Number(e.target.value) })}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field
            label="Persona"
            hint="Chi è e che taglio ha. Le regole valide per tutti stanno in Regole, non qui."
          >
            <textarea
              className={`${inputClass} min-h-24`}
              value={draft.persona}
              placeholder="Es. Attento alle distinzioni concettuali, porta esempi dalla storia della matematica…"
              onChange={(e) => patch({ persona: e.target.value })}
            />
          </Field>
        </div>
      </div>

      <div className="border-line flex flex-wrap items-center gap-3 border-t px-5 py-3">
        <button
          onClick={save}
          disabled={saving}
          className="bg-ink text-page rounded-md px-4 py-1.5 text-sm font-medium transition-transform active:scale-[0.97] disabled:opacity-40"
        >
          {saving ? "Salvo…" : "Salva"}
        </button>
        <button
          onClick={runTest}
          disabled={testing || !draft.model}
          className="border-line-strong hover:bg-raised rounded-md border px-4 py-1.5 text-sm transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {testing ? "Provo…" : "Prova"}
        </button>
        {saved && (
          <span className="text-good font-mono text-[0.6875rem]">salvato</span>
        )}
      </div>

      {/* L'esito della prova è la risposta vera dell'ospite: si legge come tale,
          in serif, non come una riga di log. */}
      {test && (
        <div
          className={`border-t px-5 py-4 ${
            test.ok ? "border-line bg-raised/50" : "border-live/40 bg-live/10"
          }`}
        >
          {test.ok ? (
            <>
              <p className="text-ink-faint font-mono text-[0.6875rem]">
                {test.model} · {test.latencyMs} ms · {test.usage?.inputTokens} in
                / {test.usage?.outputTokens} out
              </p>
              <p className="font-serif text-ink mt-2 text-[0.9375rem] italic">
                “{test.text}”
              </p>
            </>
          ) : (
            <p className="text-live font-mono text-xs whitespace-pre-wrap">
              {test.error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

const inputClass =
  "w-full rounded-md border border-line bg-raised px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint outline-none transition-colors focus:border-line-strong disabled:opacity-50";

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
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && (
        <span className="text-ink-faint mt-1.5 block text-[0.6875rem] leading-snug">
          {hint}
        </span>
      )}
    </label>
  );
}
