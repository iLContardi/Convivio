import { createEpisode, listEpisodes } from "@/lib/db/episodes";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ episodes: listEpisodes() });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    topic?: string;
    brief?: string;
    hostName?: string;
    opening?: string;
    participants?: { guestId: string; role?: string | null }[];
  };

  if (!body.topic?.trim()) {
    return Response.json({ error: "Il tema è obbligatorio" }, { status: 400 });
  }
  if (!body.participants?.length) {
    return Response.json(
      { error: "Serve almeno un ospite al tavolo" },
      { status: 400 },
    );
  }
  if (!body.opening?.trim()) {
    return Response.json(
      { error: "Serve un'introduzione di chi modera" },
      { status: 400 },
    );
  }

  const episode = createEpisode({
    topic: body.topic.trim(),
    brief: body.brief ?? "",
    hostName: body.hostName,
    participants: body.participants,
    opening: body.opening.trim(),
  });

  return Response.json({ episode }, { status: 201 });
}
