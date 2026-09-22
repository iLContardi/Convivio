import { listGuests } from "@/lib/db/guests";
import { GuestsEditor, type Guest } from "@/components/GuestsEditor";

export const dynamic = "force-dynamic";

export default function GuestsPage() {
  return <GuestsEditor guests={listGuests() as Guest[]} />;
}
