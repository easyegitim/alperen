import { ApiError } from "@/lib/api/errors";
import { noContent, withGuard } from "@/lib/api/guard";

export const runtime = "nodejs";

/** Faz 13 madde 4: 7 gün içinde "Silme talebini iptal et" → deletion_requested_at = null → 204. */
export const POST = withGuard({}, async ({ user, supabase }) => {
  const { data } = await supabase.from("profiles").select("deletion_requested_at").eq("id", user.id).maybeSingle();
  if (!data?.deletion_requested_at) throw new ApiError("BAD_INPUT", "Bekleyen silme talebi yok.");
  const { error } = await supabase.from("profiles").update({ deletion_requested_at: null, updated_at: new Date().toISOString() }).eq("id", user.id);
  if (error) throw new Error("silme talebi iptal edilemedi");
  return noContent();
});
