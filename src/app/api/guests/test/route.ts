import { getProvider, MissingKeyError } from "@/lib/providers";
import type { GuestParams } from "@/lib/providers";

export const dynamic = "force-dynamic";

/**
 * Ping di configurazione: un turno minimo, per confermare che chiave, modello e
 * parametri reggono davvero prima di scoprirlo a conversazione iniziata.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as {
    provider: string;
    model: string;
    params?: GuestParams;
    maxTokens?: number;
  };

  if (!body.provider || !body.model) {
    return Response.json(
      { error: "Servono `provider` e `model`" },
      { status: 400 },
    );
  }

  const started = Date.now();

  try {
    const stream = getProvider(body.provider).stream({
      model: body.model,
      system:
        "Rispondi in italiano, in una sola frase breve. Non aggiungere altro.",
      messages: [{ role: "user", content: "Presentati in una frase." }],
      maxTokens: body.maxTokens ?? 4000,
      params: body.params ?? {},
    });

    let text = "";
    let usage = { inputTokens: 0, outputTokens: 0 };
    let model = body.model;

    for await (const event of stream) {
      if (event.type === "text") text += event.text;
      else {
        usage = event.usage;
        model = event.model;
      }
    }

    return Response.json({
      ok: true,
      text: text.trim(),
      model,
      usage,
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    if (error instanceof MissingKeyError) {
      return Response.json({ ok: false, error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, error: message }, { status: 502 });
  }
}
