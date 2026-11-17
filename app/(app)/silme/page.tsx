import { redirect } from "next/navigation";
import { CancelDeletionCard } from "@/components/account/CancelDeletionCard";
import { purgeDateFor } from "@/lib/account/consents";
import { createClient } from "@/lib/db/server";

/** Silme talebi bekleyen hesap: (gated) grubundaki her ekran buraya döner. Talep yoksa /hesap. */
export default async function DeletionPendingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const { data } = await supabase.from("profiles").select("deletion_requested_at").eq("id", user.id).maybeSingle();
  const requestedAt = data?.deletion_requested_at ? String(data.deletion_requested_at) : null;
  if (!requestedAt) redirect("/hesap");
  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <CancelDeletionCard requestedAt={requestedAt} purgeAt={purgeDateFor(requestedAt).toISOString()} />
    </div>
  );
}
