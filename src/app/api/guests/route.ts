import { listGuests, updateGuest } from "@/lib/db/guests";
import type { ProviderId } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ guests: listGuests() });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    provider?: ProviderId;
    [key: string]: unknown;
  };

  if (!body.provider) {
    return Response.json({ error: "Campo `provider` mancante" }, { status: 400 });
  }

  const { provider, ...patch } = body;
  try {
    return Response.json({ guest: updateGuest(provider, patch) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
