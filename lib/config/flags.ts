// Özellik bayrakları (SPEC 2 D11, 5.1; CONTRACTS_V2.md §6). Varsayılan kapalı; yalnız "true" açar.
export const FLAGS = {
  expertNetwork: "FEATURE_EXPERT_NETWORK",
  weekPass: "FEATURE_WEEK_PASS",
  /** Sağlayıcı adlarını arayüzde göster (UI spec §5.3). Hukuki onay (KVKK m.9, saklama) gelince açılır; kapalıyken "yapay zekâ". */
  providerNames: "FEATURE_PROVIDER_NAMES",
  /** 18 altı yaş bandı girişi (KB Ç1, PLAN Ç-G). Veli izni ve mağaza derecesi avukatla netleşene kadar kapalı: "yakında" ekranı. */
  under18: "FEATURE_UNDER_18",
  /** Genel skorda normal dağılım yüzdeliği (KB Ç6). Anthropic teyidi gelene kadar kapalı; kapalıyken percentile null. */
  percentile: "FEATURE_PERCENTILE",
  /** Doktor katmanı (KB Ç3): hekim inceleme akışı kurulana kadar kapalı; kapalıyken öneri kullanıcıya hiç gitmez. */
  doctorLayer: "FEATURE_DOCTOR_LAYER",
  /** 5 davetle yalnız genel skor (KB Ç12). Cihaz doğrulama yöntemi AÇIK (§11.15); kapalıyken davet kilidi yok. */
  referralUnlock: "FEATURE_REFERRAL_UNLOCK",
  /** Yıllık plan paywall'da (KB §11.1 AÇIK). Kapalıyken yalnız tek seferlik rapor + haftalık + aylık. */
  yearlyPlan: "FEATURE_YEARLY_PLAN",
} as const;

export type FlagKey = keyof typeof FLAGS;

export function isFeatureEnabled(flag: FlagKey, env: Record<string, string | undefined> = process.env): boolean {
  return env[FLAGS[flag]]?.trim().toLowerCase() === "true";
}
