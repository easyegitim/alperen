import { z } from "zod";
import { DELETE_CONFIRM_WORD, isDeleteConfirmed } from "@/lib/account/consents";
import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { track } from "@/lib/analytics";
import { IyzicoError } from "@/lib/billing/iyzico";
import { cancelSubscription } from "@/lib/billing/subscriptions";
import { createAdminClient } from "@/lib/db/admin";

export const runtime = "nodejs";

const Input = z.object({ confirm: z.string().min(1).max(8) });

/**
 * SPEC 14 / Faz 13 madde 4: POST /api/me/delete { confirm: "SİL" } → 202.
 * Sıra: iyzico iptali → profiles.deletion_requested_at → oturum kapatma. 7 gün sonra gece işi (purge_deleted_users)
 * auth.users satırını siler; cascade ile tüm tablolardan veri gider. IndexedDB temizliği istemcide yapılır.
 */
export const POST = withGuard({ schema: Input }, async ({ user, supabase, input }) => {
  if (!isDeleteConfirmed(input.confirm)) throw new ApiError("BAD_INPUT", `Onay için "${DELETE_CONFIRM_WORD}" yazmalısın.`);

  // 1) Aktif abonelik varsa iyzico'da iptal; iletilemezse yine de silme talebi kaydedilir (kullanıcının hakkı), iptal yeniden denenir.
  const { data: sub } = await supabase.from("subscriptions").select("status, provider_subscription_ref, cancel_at_period_end").eq("user_id", user.id).maybeSingle();
  let subscriptionCancelPending = false;
  if (sub && ["active", "past_due", "pending"].includes(String(sub.status)) && !sub.cancel_at_period_end) {
    const ref = sub.provider_subscription_ref ? String(sub.provider_subscription_ref) : null;
    if (ref && !ref.startsWith("onetime:")) {
      try {
        await cancelSubscription(ref);
      } catch (e) {
        subscriptionCancelPending = true;
        console.error("[me/delete] abonelik iptali iletilemedi:", e instanceof IyzicoError ? e.message : "hata");
      }
    }
    const admin = createAdminClient();
    await admin.from("subscriptions").update({ cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq("user_id", user.id);
  }

  // 2) Silme talebi (RLS p_profiles_update: yalnız kendi satırı)
  const requestedAt = new Date().toISOString();
  const { error } = await supabase.from("profiles").update({ deletion_requested_at: requestedAt, updated_at: requestedAt }).eq("id", user.id);
  if (error) throw new Error("silme talebi kaydedilemedi");
  track("account_deletion_requested");

  // 3) Oturumu kapat (çerez akışı). Bearer (mobil) akışında sunucuda oturum yoktur; istemci kendi kapatır.
  await supabase.auth.signOut().catch(() => undefined);

  return Response.json({ deletionRequestedAt: requestedAt, subscriptionCancelPending }, { status: 202 });
});
