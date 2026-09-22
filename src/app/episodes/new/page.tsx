import { listGuests } from "@/lib/db/guests";
import { NewEpisodeForm, type Guest } from "@/components/NewEpisodeForm";

export const dynamic = "force-dynamic";

export default function NewEpisodePage() {
  return <NewEpisodeForm guests={listGuests() as Guest[]} />;
}
