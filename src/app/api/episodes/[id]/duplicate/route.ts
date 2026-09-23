import { currentFormatId, duplicateEpisode } from "@/lib/db/episodes";

export const dynamic = "force-dynamic";

/**
 * Riapre la stessa conversazione da capo: stesse premesse, solo l'intervento
 * di apertura, nessun turno degli ospiti.
 *
 * `useCurrentFormat` sceglie le regole. Per difetto si eredita la versione
 * dell'originale, così l'unica variabile che cambia sono i modelli — che sono
 * configurazione globale e quindi già i più recenti.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    useCurrentFormat?: boolean;
  };

  const result = duplicateEpisode(id, {
    formatId: body.useCurrentFormat ? currentFormatId() : undefined,
  });

  if (!result.ok) {
    return result.reason === "missing"
      ? Response.json({ error: "Conversazione inesistente" }, { status: 404 })
      : Response.json(
          {
            error:
              "Questa conversazione non ha un intervento di apertura da copiare.",
          },
          { status: 422 },
        );
  }

  return Response.json({ episode: result.episode }, { status: 201 });
}
