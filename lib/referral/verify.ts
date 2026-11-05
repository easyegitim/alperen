import "server-only";

/**
 * Cihaz doğrulama YER TUTUCUSU (KB §3.1/9 Claude notu, §11.15 AÇIK): sahte hesaplara karşı davet kabulünde cihaz doğrulaması
 * gerekir; yöntem (Turnstile + cihaz parmak izi, App Attest / Play Integrity vb.) kurucu kararı bekler. Bu sprintte doğrulama
 * yapılmaz ve bu açıkça kaydedilir; FEATURE_REFERRAL_UNLOCK zaten kapalı başlar. Yöntem seçilince yalnız bu dosya değişir.
 */
export type DeviceVerification = { ok: true; method: "none" } | { ok: false; reason: "device_check_failed" };

export async function verifyReferralDevice(_req: Request): Promise<DeviceVerification> {
  void _req;
  return { ok: true, method: "none" };
}
