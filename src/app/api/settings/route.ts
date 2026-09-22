import { getSettings, updateSettings } from "@/lib/db/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ settings: getSettings() });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    showName?: string;
    hostName?: string;
  };
  return Response.json({ settings: updateSettings(body) });
}
