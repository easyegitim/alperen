// SPEC 13.1 consent_type enum'u ve 16.2 rıza kuralları. Metin sürümleri content/legal/*.md'den gelir.
export const CONSENT_TYPES = [
  "kvkk_notice_ack",
  "biometric_processing",
  "photo_ai_analysis",
  "cross_border_transfer",
  "tryon_generation",
  "expert_data_sharing",
  "marketing",
  "analytics_cookies",
  "distance_sales_terms",
  "instant_performance_waiver",
] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

/** Analiz için zorunlu üç açık rıza (SPEC 4.1 adım 4, 16.2). */
export const REQUIRED_ANALYSIS_CONSENTS = ["biometric_processing", "photo_ai_analysis", "cross_border_transfer"] as const satisfies readonly ConsentType[];

/** İzinler ekranındaki isteğe bağlı rızalar. */
export const OPTIONAL_ONBOARDING_CONSENTS = ["marketing"] as const satisfies readonly ConsentType[];

export const LEGAL_SLUGS = [
  "aydinlatma",
  "acik-riza",
  "gizlilik",
  "cerez",
  "kullanim-kosullari",
  "mesafeli-satis",
  "on-bilgilendirme",
  "iptal-iade",
] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

/** Her rıza türünün dayandığı metin; textVersion bu belgenin sürümüdür. */
export const CONSENT_DOC: Record<ConsentType, LegalSlug> = {
  kvkk_notice_ack: "aydinlatma",
  biometric_processing: "acik-riza",
  photo_ai_analysis: "acik-riza",
  cross_border_transfer: "acik-riza",
  tryon_generation: "acik-riza",
  expert_data_sharing: "acik-riza",
  marketing: "acik-riza",
  analytics_cookies: "cerez",
  distance_sales_terms: "mesafeli-satis",
  instant_performance_waiver: "on-bilgilendirme",
};

export type ConsentState = Partial<Record<ConsentType, { granted: boolean; textVersion: string }>>;

/** Zorunlu rızaların tamamı güncel sürümle verilmiş mi? */
export function hasRequiredAnalysisConsents(state: ConsentState, currentVersion: (t: ConsentType) => string): boolean {
  return REQUIRED_ANALYSIS_CONSENTS.every((t) => {
    const c = state[t];
    return Boolean(c && c.granted && c.textVersion === currentVersion(t));
  });
}

/** Çerez banner'ı için zorunlu (teknik) çerez adı ve değerleri. */
export const COOKIE_CONSENT_NAME = "aura_cookies";
export type CookieConsentValue = "granted" | "denied";
