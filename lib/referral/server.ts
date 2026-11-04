import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateReferralCode } from "./code";
import { referralProgress, type ReferralProgress } from "./unlock";

/** Kullanıcının davet kodu; yoksa üretir ve yazar (service role). Çakışmada (unique) birkaç kez yeniden dener. */
export async function getOrCreateReferralCode(admin: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await admin.from("profiles").select("referral_code").eq("id", userId).maybeSingle();
  if (error) throw new Error("profil okunamadı");
  if (typeof data?.referral_code === "string" && data.referral_code) return data.referral_code;
  for (let i = 0; i < 5; i++) {
    const code = generateReferralCode();
    const { error: e } = await admin.from("profiles").update({ referral_code: code }).eq("id", userId).is("referral_code", null);
    if (!e) return code;
    if (e.code !== "23505") throw new Error("davet kodu yazılamadı");
  }
  throw new Error("davet kodu üretilemedi");
}

export async function getReferralProgress(admin: SupabaseClient, userId: string): Promise<ReferralProgress> {
  const { data, error } = await admin.from("referrals").select("referee_id, photo_submitted_at").eq("referrer_id", userId);
  if (error) throw new Error("davetler okunamadı");
  return referralProgress((data ?? []).map((r) => ({ referee_id: String(r.referee_id), photo_submitted_at: r.photo_submitted_at ? String(r.photo_submitted_at) : null })));
}

/** W2 AccessV2.referralUnlock için: bayrak açık ve ≥ 5 davetli fotoğraf yolladıysa true. */
export async function isReferralUnlocked(admin: SupabaseClient, userId: string): Promise<boolean> {
  return (await getReferralProgress(admin, userId)).unlocked;
}
