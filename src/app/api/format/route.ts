import { ensureDefaultFormat, getFormat, updateFormat } from "@/lib/db/episodes";
import type { Phase } from "@/lib/prompt/format";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ format: getFormat() });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    body?: string;
    phases?: Partial<Record<Phase, string>>;
  };

  const id = ensureDefaultFormat();
  return Response.json({ format: updateFormat(id, body) });
}
