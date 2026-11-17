// Davet kodu girişi (KB P#15/Ç12; CONTRACTS_V2 S3.3.5). Saf; web ve mobil. Ayrı claim rotası yok: POST /api/referral { code }.
// Sunucu BAD_INPUT mesajında nedeni taşır (unknown_code | self | already_claimed | device_check_failed); FEATURE_DISABLED → disabled.
export type ClaimErrorKey = "unknown_code" | "self" | "already_claimed" | "device" | "disabled" | "format" | "generic";

/** Hata kodu + mesaj → referral.claim.errors.* anahtarı. */
export function claimErrorKey(code: string, message: string = ""): ClaimErrorKey {
  if (code === "FEATURE_DISABLED") return "disabled";
  if (code === "BAD_INPUT") {
    if (message.includes("unknown_code")) return "unknown_code";
    if (message.includes("self")) return "self";
    if (message.includes("already_claimed")) return "already_claimed";
    if (message.includes("device")) return "device";
  }
  return "generic";
}

/** Davet ilerleme çubuğu oranı (0–1); total 0 ise 0. */
export function referralRatio(done: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, done / total));
}
