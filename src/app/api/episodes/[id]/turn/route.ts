import { runTurn } from "@/lib/engine/run-turn";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * Genera il prossimo turno e lo streamma come SSE.
 *
 * Se il client chiude la connessione (chi modera preme "Ferma ora"), il
 * segnale arriva al provider: il testo già prodotto resta in trascrizione,
 * marcato come interrotto.
 */
export async function POST(request: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    guestId?: string;
    regenerateTurnId?: string;
  };

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      };

      try {
        for await (const event of runTurn(id, {
          guestId: body.guestId,
          regenerateTurnId: body.regenerateTurnId,
          signal: request.signal,
        })) {
          send(event);
        }
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
