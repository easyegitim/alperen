// Plan ve ödeme sonrası kişiselleştirme sözlükleri (KB §3.2/5–6, §6.1, §6.2, §6.6; PLAN_V2 Faz 4c/4d; CONTRACTS_V2 Sprint 2).
// Saf, paylaşılan (mobil içe aktarabilir). Tutarlar KB taslağıdır: bütçe bantları AÇIK (§11.3), kurucu verene kadar
// `placeholder: true` ile işaretlidir; arayüz metinleri messages/tr.json "questionnaire.v2.*" ve "plan.v2.*" altında.

/** Plan fazları (KB §6.1): 0–4 hafta · 1–3 ay · 3–6 ay. Sıra = ekran sırası. */
export const PLAN_PHASES = ["weeks_0_4", "months_1_3", "months_3_6"] as const;
export type PlanPhase = (typeof PLAN_PHASES)[number];

/** Üç katman (KB §6.1): Kendin yap · Uzman (berber, estetisyen) · Doktor (yalnız FEATURE_DOCTOR_LAYER ve hekim onayı). */
export const PLAN_TIERS = ["diy", "expert", "doctor"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

/** Plan ekranı sekmeleri / adım alanları (KB §6.1 mock-up: Saç · Sakal · Saç rengi · Cilt · Egzersizler; + kaş, alışkanlık, stil). */
export const PLAN_AREAS = ["hair", "beard", "color", "skin", "brows", "exercise", "habit", "style"] as const;
export type PlanArea = (typeof PLAN_AREAS)[number];

/**
 * Kanıt seviyeleri (KB §6.2, R2-Ö6): TDB'deki A/B/C içeride kalır; kullanıcı yalnız cümleyi görür
 * (tr.json plan.v2.evidence.*). Eşleme: A → many_studies, B → limited_studies, C → expert_opinion.
 */
export const EVIDENCE_LEVELS = ["many_studies", "limited_studies", "expert_opinion"] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];
export const EVIDENCE_FROM_GRADE: Record<"A" | "B" | "C", EvidenceLevel> = { A: "many_studies", B: "limited_studies", C: "expert_opinion" };

/** Aylık bakım bütçesi bantları (KB §6.6 taslağı, R2-C8; AÇIK §11.3). Değerler KDV dahil TL. */
export const BUDGET_BANDS = ["upto_1000", "1000_2500", "2500_5000", "5000_plus"] as const;
export type BudgetBand = (typeof BUDGET_BANDS)[number];
export const BUDGET_BAND_TRY: Record<BudgetBand, { min: number; max: number | null }> = {
  upto_1000: { min: 0, max: 1000 },
  "1000_2500": { min: 1000, max: 2500 },
  "2500_5000": { min: 2500, max: 5000 },
  "5000_plus": { min: 5000, max: null },
};

/** Tek seferlik uzman / klinik bütçesi (KB §6.6 taslağı): şimdilik yok / 15.000'e kadar / 15–60 bin / 60 bin üstü / bilmiyorum. */
export const ONE_TIME_BUDGET_BANDS = ["none", "upto_15000", "15000_60000", "60000_plus", "unknown"] as const;
export type OneTimeBudgetBand = (typeof ONE_TIME_BUDGET_BANDS)[number];
export const ONE_TIME_BUDGET_BAND_TRY: Record<OneTimeBudgetBand, { min: number; max: number | null } | null> = {
  none: null,
  upto_15000: { min: 0, max: 15_000 },
  "15000_60000": { min: 15_000, max: 60_000 },
  "60000_plus": { min: 60_000, max: null },
  unknown: null,
};

/** Günde ayrılabilecek süre (KB §3.2/5; değer listesi CLAUDE NOTU — KB sayı vermez; eski anketin 5/10/20'si + 30). */
export const TIME_BANDS = [5, 10, 20, 30] as const;
export type TimeBand = (typeof TIME_BANDS)[number];

/** Aktivite, somut seçeneklerle (KB R1-E4): haftada kaç gün spor; masa başı ya da ayakta iş. */
export const SPORT_DAYS = ["0_1", "2_3", "4_plus"] as const;
export type SportDays = (typeof SPORT_DAYS)[number];
export const WORK_TYPES = ["desk", "standing"] as const;
export type WorkType = (typeof WORK_TYPES)[number];

/** Hedef yönü (KB R2-Ö7, Ç7): maskülenlik/feminenlik skoru yok; yönü kullanıcı seçer. */
export const GOAL_DIRECTIONS = ["sharper_mature", "softer_younger", "as_is_groomed"] as const;
export type GoalDirection = (typeof GOAL_DIRECTIONS)[number];

/** Saç uzunluğu tercihi (avatar üzerinde; KB R1-E1). */
export const HAIR_LENGTH_PREFS = ["short", "medium", "long", "keep"] as const;
export type HairLengthPref = (typeof HAIR_LENGTH_PREFS)[number];

/** Sakal uzunluğu tercihi (avatar üzerinde). */
export const BEARD_LENGTH_PREFS = ["none", "stubble", "short", "medium", "long", "keep"] as const;
export type BeardLengthPref = (typeof BEARD_LENGTH_PREFS)[number];

/** Beden algısı taraması (KB §6.4, R2-Ö4): 3–4 soru; "risk" ise doktor katmanı kapanır. Soru metinleri tr.json doctor.screen.*. */
export const BODY_IMAGE_SCREEN_RESULTS = ["ok", "risk"] as const;
export type BodyImageScreenResult = (typeof BODY_IMAGE_SCREEN_RESULTS)[number];
export const BODY_IMAGE_SCREEN_QUESTIONS = ["q1", "q2", "q3", "q4"] as const;
export type BodyImageScreenQuestion = (typeof BODY_IMAGE_SCREEN_QUESTIONS)[number];
/** CLAUDE NOTU (BDDQ benzeri eşik; klinik ölçek değil): "evet" sayısı bu değere ulaşırsa risk. */
export const BODY_IMAGE_SCREEN_RISK_YES_COUNT = 2;

/** Öncelik tablosu (KB §6.1): etki / emek; eşitlikte önce daha az emek. Saf. */
export function priorityScore(impact: 1 | 2 | 3, effort: 1 | 2 | 3): number {
  return Math.round((impact / effort) * 100) / 100;
}

/** Doktor katmanı sınırları (KB §6.1, Ç3): raporda en fazla iki öneri, her biri gerekçeli; 18 altına yok. */
export const DOCTOR_LAYER = {
  maxRecommendations: 2,
  /** Link yalnız bilimsel kaynak ve TİTCK kullanma talimatı (Ç5); eczane/satış/marka yok. */
  allowedLinkHosts: ["titck.gov.tr", "pubmed.ncbi.nlm.nih.gov", "doi.org", "cochranelibrary.com", "who.int"] as const,
  /** Kullanıcıya ulaşabilen tek durum (sunucu, admin hekim yazar). */
  deliverableStatus: "physician_reviewed" as const,
} as const;

export type PlanConfig = {
  placeholder: true;
  budgetBands: readonly BudgetBand[];
  oneTimeBudgetBands: readonly OneTimeBudgetBand[];
  timeBands: readonly TimeBand[];
};

/** Kurucu tutarları verene kadar yer tutucu (KB §11.3). Env ile değiştirilmez: bant adları sözleşmedir, tutarlar metinde. */
export const PLAN_CONFIG: PlanConfig = {
  placeholder: true,
  budgetBands: BUDGET_BANDS,
  oneTimeBudgetBands: ONE_TIME_BUDGET_BANDS,
  timeBands: TIME_BANDS,
};
