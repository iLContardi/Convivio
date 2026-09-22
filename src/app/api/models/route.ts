import { getProvider, MissingKeyError } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const provider = new URL(request.url).searchParams.get("provider");
  if (!provider) {
    return Response.json({ error: "Parametro `provider` mancante" }, { status: 400 });
  }

  try {
    const models = await getProvider(provider).listModels();
    return Response.json({ models });
  } catch (error) {
    if (error instanceof MissingKeyError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 502 });
  }
}
