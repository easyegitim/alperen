// SPEC 9.2 / D08: egzersizler yalnız jawHealth "hiçbiri" iken.
import type { Questionnaire } from "@/lib/questionnaire";

export function exerciseEligible(q: Pick<Questionnaire, "jawHealth">): boolean {
  return q.jawHealth.length === 0;
}

/** Başörtüsü varsa saç önerisi yok (SPEC 9.8 kural 8). */
export function hairAdviceAllowed(q: Pick<Questionnaire, "headCovering">): boolean {
  return !q.headCovering;
}
