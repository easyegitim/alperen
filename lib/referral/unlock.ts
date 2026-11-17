// Davet kilidi kuralları (KB P#15/Ç12; CONTRACTS_V2 §2.3, §6): davet edilen 5 kişi fotoğraf yollayınca (device_only
// analiz) yalnız genel skor açılır; potansiyel, alt skorlar, rapor ve plan ödemeyle. Saf; birim testi var.
import { ENTITLEMENTS_V2 } from "@/lib/config/plans";

export const REFERRAL_INVITES_REQUIRED: number = ENTITLEMENTS_V2.referral.invitesRequired;

export type ReferralRow = { referee_id: string; photo_submitted_at: string | null };

export type ReferralProgress = { done: number; total: number; pending: number; unlocked: boolean };

/** Yalnız fotoğraf yollamış davetliler sayılır; aynı davetli bir kez (referee_id tekil). */
export function referralProgress(rows: readonly ReferralRow[], required: number = REFERRAL_INVITES_REQUIRED): ReferralProgress {
  const seen = new Set<string>();
  let done = 0;
  let pending = 0;
  for (const r of rows) {
    if (seen.has(r.referee_id)) continue;
    seen.add(r.referee_id);
    if (r.photo_submitted_at) done++;
    else pending++;
  }
  return { done, total: required, pending, unlocked: done >= required };
}

export type ClaimCheck = { ok: true } | { ok: false; reason: "self" | "already_claimed" | "unknown_code" };

/** Davet kabulü: kendi kodu olamaz, bir kullanıcı yalnız bir kez davet edilir, kod bir sahibe çözülmeli. */
export function checkClaim(p: { referrerId: string | null; refereeId: string; alreadyReferred: boolean }): ClaimCheck {
  if (!p.referrerId) return { ok: false, reason: "unknown_code" };
  if (p.referrerId === p.refereeId) return { ok: false, reason: "self" };
  if (p.alreadyReferred) return { ok: false, reason: "already_claimed" };
  return { ok: true };
}
