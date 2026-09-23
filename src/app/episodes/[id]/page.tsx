import { notFound } from "next/navigation";
import {
  getParticipants,
  getEpisode,
  getFormat,
  getTurns,
  nextSpeaker,
} from "@/lib/db/episodes";
import { listGuests } from "@/lib/db/guests";
import { Conversation, type ConversationData } from "@/components/Conversation";

export const dynamic = "force-dynamic";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const episode = getEpisode(id);
  if (!episode) notFound();

  const initial = {
    episode,
    turns: getTurns(id),
    guests: listGuests(),
    participants: getParticipants(id),
    next: nextSpeaker(id),
    // Quale versione delle regole ha condotto questa conversazione. È fissata
    // alla creazione e non cambia più.
    formatVersion: getFormat(episode.formatId).version,
  } as ConversationData;

  return <Conversation initial={initial} />;
}
