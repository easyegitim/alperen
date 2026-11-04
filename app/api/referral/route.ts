import { z } from "zod";
import { ApiError } from "@/lib/api/errors";
import { withGuard } from "@/lib/api/guard";
import { isFeatureEnabled } from "@/lib/config/flags";
import { createAdminClient } from "@/lib/db/admin";
import { normalizeReferralCode } from "@/lib/referral/code";
import { getOrCreateReferralCode, getReferralProgress } from "@/lib/referral/server";
import { checkClaim } from "@/lib/referral/unlock";
import { verifyReferralDevice } from "@/lib/referral/verify";

export const runtime = "nodejs";

function assertEnabled() {
  // Kapalıyken var/yok ayrımı yapılmaz (404 biçiminde FEATURE_DISABLED), uzman ağı kalıbı.
  if (!isFeatureEnabled("referralUnlock")) throw new ApiError("FEATURE_DISABLED", "Bulunamadı.");
}

/** GET /api/referral → { code, progress:{done,total,pending}, unlocked }. Anonim oturum yok (v2). */
export const GET = withGuard({ allowAnonymous: false }, async ({ user }) => {
  assertEnabled();
  const admin = createAdminClient();
  const [code, progress] = await Promise.all([getOrCreateReferralCode(admin, user.id), getReferralProgress(admin, user.id)]);
  return Response.json({ code, progress: { done: progress.done, total: progress.total, pending: progress.pending }, unlocked: progress.unlocked });
});

const ClaimInput = z.object({ code: z.string().min(8).max(20) });

/**
 * POST /api/referral { code } → 204. Davet edilen kullanıcı kodu girer; satır referrals'a yazılır (photo_submitted_at boş;
 * device_only analiz yollayınca rota doldurur). Kendi kodu, ikinci davet ve bilinmeyen kod BAD_INPUT. Cihaz doğrulaması
 * yer tutucudur (lib/referral/verify.ts, KB §11.15 AÇIK).
 */
export const POST = withGuard({ schema: ClaimInput, allowAnonymous: false }, async ({ req, user, input }) => {
  assertEnabled();
  const code = normalizeReferralCode(input.code);
  if (!code) throw new ApiError("BAD_INPUT", "unknown_code");
  const device = await verifyReferralDevice(req);
  if (!device.ok) throw new ApiError("BAD_INPUT", device.reason);
  const admin = createAdminClient();
  const [{ data: owner }, { data: existing }] = await Promise.all([
    admin.from("profiles").select("id").eq("referral_code", code).maybeSingle(),
    admin.from("referrals").select("id").eq("referee_id", user.id).maybeSingle(),
  ]);
  const check = checkClaim({ referrerId: owner ? String(owner.id) : null, refereeId: user.id, alreadyReferred: Boolean(existing) });
  if (!check.ok) throw new ApiError("BAD_INPUT", check.reason);
  const { error } = await admin.from("referrals").insert({ code, referrer_id: String(owner!.id), referee_id: user.id });
  // Eşzamanlı ikinci istek (çift dokunma / iki sekme): unique(referee_id) ihlali = zaten kayıtlı davet; veritabanı kaynaktır.
  if (error?.code === "23505") throw new ApiError("BAD_INPUT", "already_claimed");
  if (error) throw new Error("davet kaydedilemedi");
  return new Response(null, { status: 204 });
});
