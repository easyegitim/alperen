export const AGE_GATE_PATH = "/baslangic/yas";
/** v2 (KB §3.1): yaş → cinsiyet → hesap (Google/Apple) → rızalar → fotoğraflar. İlk üçü oturumsuz açılır. */
export const GENDER_PATH = "/baslangic/cinsiyet";
export const SIGN_IN_PATH = "/baslangic/giris";
export const CONSENTS_PATH = "/baslangic/izinler";
/** Anket ödeme sonrasına taşındı (KB R2-C13); yol plan ekranı önünde kullanılmak üzere duruyor (PLAN 4c). */
export const QUESTIONNAIRE_PATH = "/baslangic/anket";
/** Oturum gerekmeyen başlangıç ekranları ((app)/layout bunları oturumsuz geçirir). */
export const PUBLIC_ONBOARDING_PATHS = [AGE_GATE_PATH, GENDER_PATH, SIGN_IN_PATH] as const;
export const CAPTURE_PATH = "/tara";
/** Silme talebi bekleyen hesap: "Silme talebini iptal et" ekranı (SPEC Faz 13 madde 4). */
export const DELETION_PATH = "/silme";

export type GateProfile = { is_adult: boolean; onboarding_completed_at: string | null; deletion_requested_at?: string | null } | null;

/**
 * SPEC Faz 2 madde 5: is_adult false → /baslangic/yas; onboarding_completed_at boş → /baslangic/izinler.
 * Faz 13: deletion_requested_at doluysa her uygulama ekranı /silme'ye döner (7 gün içinde iptal edilebilir).
 * Profil satırı yoksa (tetikleyici henüz çalışmadı) yaş kapısına gönderilir. Saf fonksiyon; birim testi var.
 */
export function getOnboardingRedirect(profile: GateProfile): string | null {
  if (!profile || !profile.is_adult) return AGE_GATE_PATH;
  if (profile.deletion_requested_at) return DELETION_PATH;
  if (!profile.onboarding_completed_at) return CONSENTS_PATH;
  return null;
}
