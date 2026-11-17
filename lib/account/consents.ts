// SPEC 16.2 / Faz 13: /hesap rıza yönetimi. Saf kurallar; birim testi var.
import type { ConsentType } from "@/lib/consent";

/** /hesap'ta anahtarla yönetilebilen rızalar. Sözleşmesel onaylar (mesafeli satış, cayma feragati) ve
 *  aydınlatma "okudum" kaydı geri alınabilir bir rıza değildir; listede yer almaz. */
export const MANAGEABLE_CONSENTS = [
  "biometric_processing",
  "photo_ai_analysis",
  "cross_border_transfer",
  "tryon_generation",
  "expert_data_sharing",
  "marketing",
  "analytics_cookies",
] as const satisfies readonly ConsentType[];
export type ManageableConsent = (typeof MANAGEABLE_CONSENTS)[number];

export function isManageableConsent(t: string): t is ManageableConsent {
  return (MANAGEABLE_CONSENTS as readonly string[]).includes(t);
}

/** Geri almanın ürün etkisi (arayüz metni anahtarı). */
export type RevokeEffect = "analysis_blocked" | "tryon_blocked" | "expert_sharing_blocked" | "marketing_stopped" | "analytics_stopped";

export function revokeEffects(type: ManageableConsent): RevokeEffect[] {
  switch (type) {
    case "biometric_processing":
    case "photo_ai_analysis":
      return ["analysis_blocked", "tryon_blocked"];
    case "cross_border_transfer":
      return ["analysis_blocked", "tryon_blocked", "expert_sharing_blocked"];
    case "tryon_generation":
      return ["tryon_blocked"];
    case "expert_data_sharing":
      return ["expert_sharing_blocked"];
    case "marketing":
      return ["marketing_stopped"];
    case "analytics_cookies":
      return ["analytics_stopped"];
  }
}

/** SPEC 16.2: biometric_processing geri alınınca "Geçmiş analizlerin de silinsin mi?" sorulur (varsayılan evet). */
export function offersAnalysisDeletion(type: ConsentType, granted: boolean): boolean {
  return type === "biometric_processing" && granted === false;
}

/** Silme talebi: 7 gün sonra gece işi hesabı siler (SPEC 13.4). */
export const DELETION_GRACE_DAYS = 7;

export function purgeDateFor(deletionRequestedAt: string | Date): Date {
  const d = new Date(deletionRequestedAt);
  return new Date(d.getTime() + DELETION_GRACE_DAYS * 86_400_000);
}

/** POST /api/me/delete gövdesindeki onay sözcüğü (SPEC 14). Türkçe büyük İ ile tam eşleşme. */
export const DELETE_CONFIRM_WORD = "SİL";

export function isDeleteConfirmed(word: string): boolean {
  return word === DELETE_CONFIRM_WORD;
}
