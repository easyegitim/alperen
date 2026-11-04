import { z } from "zod";
import { EVIDENCE_LEVELS, PLAN_AREAS, PLAN_PHASES, PLAN_TIERS, priorityScore, type PlanArea, type PlanPhase, type PlanTier } from "@/lib/config/plan";
import { REGION_KEYS, type RegionKey } from "@/lib/score/contract";

// PlanV2 — Sprint 2 plan sözleşmesi (KB §6.1–6.3, Ç1–Ç5; PLAN_V2 Faz 4d/4e/4f ve §3 kişiselleştirme listesi; CONTRACTS_V2 Sprint 2).
// Saf, paylaşılan (mobil içe aktarabilir). Plan KOD tarafından kurulur: Claude yalnız bilgi tabanından (lib/coach/knowledge.ts)
// kimlik seçer ve gerekçe yazar; her kimlik kodda doğrulanır (K6/Ç2: uydurma yöntem yok). Bu şema Claude'a verilmez
// (yapılandırılmış çıktı şeması W4'te küçük ve düz tutulur); burada min/max serbesttir.
// Değişmez kurallar: skor burada yoktur ve plan skoru değiştirmez; yapısal alt skorlar (uyum, göz, çene) plana
// "bakımla değişir" diye girmez — yapısal bölgeye bağlı adım yalnız algı/stil adımıdır (perceptionOnly).
// Doktor katmanı adımları bu JSON'a YAZILMAZ: hekim kuyruğundan (doctor_recommendations, status physician_reviewed)
// okuma anında eklenir; FEATURE_DOCTOR_LAYER kapalıyken katman "off"tur.

export const PLAN_V2_VERSION = "plan.v2" as const;

/** Yapısal rapor bölgeleri: bu bölgelere bağlı adımlar yalnız algı/stil (saç, sakal, kaş, renk, stil) olabilir. */
export const STRUCTURAL_REGIONS = ["eyeArea", "nose", "cheeks", "jawline"] as const satisfies readonly RegionKey[];
/** Yapısal bölgeye bağlanabilen alanlar (algı/stil). Cilt, egzersiz ve alışkanlık yapısal bölgeye bağlanmaz. */
export const PERCEPTION_AREAS = ["hair", "beard", "brows", "color", "style"] as const satisfies readonly PlanArea[];

export const StepFrequency = z.object({
  /** once: tek seferlik (ör. kesim); diğerleri dönem başına kaç kez. */
  per: z.enum(["once", "day", "week", "month"]),
  times: z.number().int().min(1).max(14),
});
export type StepFrequency = z.infer<typeof StepFrequency>;

/** KDV dahil TL aralığı; max null = üst sınır açık; 0–0 = ücretsiz. */
export const CostTryRange = z.object({ min: z.number().int().min(0), max: z.number().int().min(0).nullable() }).refine((c) => c.max === null || c.max >= c.min, "cost_range_inverted");
export type CostTryRange = z.infer<typeof CostTryRange>;

export const Evidence = z.object({
  level: z.enum(EVIDENCE_LEVELS),
  /** Kaynak bağlantısı ya da atıf (KB §6.2 "yanında kaynak bağlantısı"); yoksa yalnız cümle gösterilir. */
  source: z.string().max(300).optional(),
});
export type Evidence = z.infer<typeof Evidence>;

/** Berber kartı (KB §8, R2-Ö2): stil adı, yanlar kaç numara, üstte kaç santim, sakal hattının nereden geçeceği. */
export const BarberSpec = z.object({
  styleName: z.string().max(80),
  sidesGuard: z.string().max(20).optional(),
  topLengthCm: z.number().min(0).max(60).optional(),
  beardLine: z.string().max(160).optional(),
  notes: z.string().max(200).optional(),
});
export type BarberSpec = z.infer<typeof BarberSpec>;

/** Hangi rapor bölgesine / gözleme cevap veriyor (PLAN §3: her adım fotoğrafta görülene bağlanır). */
export const ObservationRef = z.object({
  region: z.enum(REGION_KEYS),
  /** Raporun o bölgedeki "seen" ya da "improvements" cümlesinin kısaltılmış hali; nötr dil (safety.ts'ten geçmiş). */
  observation: z.string().max(200).optional(),
});
export type ObservationRef = z.infer<typeof ObservationRef>;

export const Level3 = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Level3 = 1 | 2 | 3;

export const StepCard = z.object({
  /** Katalog / yöntem kimliği (content/* ya da content/methods/*.json); kod doğrular. */
  id: z.string().min(1).max(80),
  area: z.enum(PLAN_AREAS),
  phase: z.enum(PLAN_PHASES),
  tier: z.enum(PLAN_TIERS),
  /** Kullanıcıya görünen nötr ad (KB §5 ÖNERİ: iç taksonomi adı rapora olduğu gibi geçmez). */
  title: z.string().min(1).max(120),
  /** Ne yapılacağı (1–2 cümle; kaydın nasıl/ne zaman metni). */
  summary: z.string().max(400).optional(),
  /** "Neden sende": Claude'un gözleme bağlı gerekçesi (safety.ts'ten geçmiş); talimatın yerini almaz. */
  rationale: z.string().max(400).optional(),
  observationRef: ObservationRef,
  costTryRange: CostTryRange,
  frequency: StepFrequency,
  minutesPerDay: z.number().min(0).max(180),
  difficulty: Level3,
  impact: Level3,
  effort: Level3,
  evidence: Evidence,
  /** Yapısal bölgeye bağlı adım yalnız algı/stil adımıdır (KB §4.9 son iki satır). */
  perceptionOnly: z.boolean().optional(),
  /** "Dene" düğmesi: content/presets kimliği. */
  tryonPresetId: z.string().max(80).optional(),
  /** "Berbere göster" kartı. */
  barberSpec: BarberSpec.optional(),
  /** Ürün / uzman bağlantıları (product_links.id); yalnız FEATURE_PRODUCT_LINKS açıkken gösterilir, "Reklam" etiketiyle. */
  linkIds: z.array(z.string().max(80)).max(5).optional(),
});
export type StepCard = z.infer<typeof StepCard>;

/** Öncelik tablosu satırı (KB §6.1): etki/emek; en üstte en az emekle en çok fark. */
export const PriorityRow = z.object({ stepId: z.string().max(80), impact: Level3, effort: Level3, score: z.number().min(0) });
export type PriorityRow = z.infer<typeof PriorityRow>;

/** "Planın şunlara göre hazırlandı" çipleri (PLAN §3): her anket cevabı ve fotoğraf gerçeği görünür iz bırakır. */
export const BASIS_CHIP_KEYS = [
  "goal",
  "goalDirection",
  "budget",
  "oneTimeBudget",
  "minutes",
  "sportDays",
  "work",
  "hairLength",
  "beardLength",
  "skinType",
  "jawHealth",
  "glasses",
  "headCovering",
  "faceShape",
  "ageBand",
  "presentation",
  /** Fotoğrafta görülen bakım ayrıntısı (R1-W4): değer nötr cümle. */
  "photoFact",
  "viewsUsed",
] as const;
export type BasisChipKey = (typeof BASIS_CHIP_KEYS)[number];
export const BASIS_SOURCES = ["questionnaire", "photo", "device", "profile"] as const;
export const BasisChip = z.object({
  key: z.enum(BASIS_CHIP_KEYS),
  /** Seçenek anahtarı (tr.json questionnaire.v2.options.* ile çevrilir) ya da kısa nötr cümle. Boy/kilo/VKİ ASLA çip olmaz. */
  value: z.string().max(120).optional(),
  source: z.enum(BASIS_SOURCES),
});
export type BasisChip = z.infer<typeof BasisChip>;

/** Bilerek eklenmeyen bölümler ve nedeni (anket/plan kurallarının görünür izi). */
export const PlanExclusions = z.object({
  hair: z.enum(["head_covering", "head_covering_unknown"]).optional(),
  beard: z.enum(["presentation", "preference"]).optional(),
  exercises: z.enum(["jaw_health"]).optional(),
  bodyFat: z.enum(["no_body", "bmi_below_25", "under_18", "restriction_signal"]).optional(),
  doctor: z.enum(["flag_off", "under_18", "screen_required", "screen_risk", "pending_review", "none"]).optional(),
});
export type PlanExclusions = z.infer<typeof PlanExclusions>;

/** Doktor katmanının okuma anındaki görünümü; adımlar yalnız physician_reviewed kayıttan gelir. */
export const DOCTOR_LAYER_STATES = ["off", "under_18", "screen_required", "screen_risk", "pending_review", "available", "none"] as const;
export type DoctorLayerState = (typeof DOCTOR_LAYER_STATES)[number];

export const DISCLAIMER_KEYS = ["notMedicalAdvice", "aiGenerated", "deterministicFallback", "cosmeticProcedures", "changeTakesWeeks", "under18Limits"] as const;
export type DisclaimerKey = (typeof DISCLAIMER_KEYS)[number];

export const PlanMeta = z.object({
  analysisId: z.string().uuid(),
  generatedAt: z.string(),
  model: z.string().max(80),
  promptVersion: z.string().max(40),
  /** Bilgi tabanı kaynağı: SPEC katalogları ya da TSV'den gelen yöntem kütüphanesi. */
  knowledgeSource: z.enum(["catalog", "methods"]),
  /** Claude'a verilen ilgili kayıt kimlikleri (≤ 40); denetim için. */
  retrievedIds: z.array(z.string().max(80)).max(40),
  /** Claude'un seçip kodun düşürdüğü bilinmeyen kimlik sayısı. */
  droppedUnknownIds: z.number().int().min(0),
});

export const PlanV2 = z
  .object({
    version: z.literal(PLAN_V2_VERSION),
    /** Faz → adım kimlikleri (sıra = ekran sırası). Her kimlik steps içinde olmalı. */
    phases: z.object({ weeks_0_4: z.array(z.string()), months_1_3: z.array(z.string()), months_3_6: z.array(z.string()) }),
    steps: z.array(StepCard).max(40),
    priorityTable: z.array(PriorityRow).max(40),
    basisChips: z.array(BasisChip).max(30),
    /** Katman → adım kimlikleri; doctor her zaman boş yazılır (okuma anında kuyruktan dolar). */
    layers: z.object({ diy: z.array(z.string()), expert: z.array(z.string()), doctor: z.array(z.string()).max(0) }),
    exclusions: PlanExclusions,
    disclaimers: z.array(z.enum(DISCLAIMER_KEYS)).min(1),
    meta: PlanMeta,
  })
  .superRefine((plan, ctx) => {
    for (const issue of planIssues(plan)) ctx.addIssue({ code: "custom", message: issue });
  });
export type PlanV2 = z.infer<typeof PlanV2>;

/** Okuma anında birleşen görünüm (sunucu kurar): plan + doktor katmanı + güncel çipler. Kilitli kullanıcıya gitmez. */
export type PlanViewV2 = {
  plan: PlanV2;
  doctor: { state: DoctorLayerState; steps: StepCard[]; disclosure: true };
  /** Anket plan üretiminden sonra değiştiyse (yeniden üretim ücretli, Ç10). */
  basisStale: boolean;
};

type PlanShape = Omit<PlanV2, never>;

/**
 * Plan tutarlılık kuralları (saf; şema superRefine ve W4 testleri aynı kaynaktan):
 * 1. phases ve layers'taki her kimlik steps içinde; her adım tam bir fazda ve tek katmanda.
 * 2. Yapısal bölgeye bağlı adım yalnız algı/stil alanında ve perceptionOnly=true (yapısal alt skor plan-nötr).
 * 3. Doktor katmanı adımı plana yazılmaz (tier "doctor" yok; layers.doctor boş).
 * 4. priorityTable yalnız mevcut adımları içerir ve score = impact/effort ile uyumlu.
 * 5. "notMedicalAdvice" uyarısı her planda.
 */
export function planIssues(plan: PlanShape): string[] {
  const issues: string[] = [];
  const ids = new Set(plan.steps.map((s) => s.id));
  if (ids.size !== plan.steps.length) issues.push("duplicate_step_id");
  const phaseIds = [...plan.phases.weeks_0_4, ...plan.phases.months_1_3, ...plan.phases.months_3_6];
  for (const id of phaseIds) if (!ids.has(id)) issues.push(`phase_unknown_step:${id}`);
  if (new Set(phaseIds).size !== phaseIds.length) issues.push("step_in_multiple_phases");
  for (const s of plan.steps) {
    if (!(plan.phases[s.phase] as string[]).includes(s.id)) issues.push(`step_phase_mismatch:${s.id}`);
    if (s.tier === "doctor") issues.push(`doctor_step_in_plan:${s.id}`);
    else if (!plan.layers[s.tier].includes(s.id)) issues.push(`step_layer_mismatch:${s.id}`);
    if ((STRUCTURAL_REGIONS as readonly string[]).includes(s.observationRef.region)) {
      if (!(PERCEPTION_AREAS as readonly string[]).includes(s.area) || s.perceptionOnly !== true) issues.push(`structural_region_needs_perception_step:${s.id}`);
    }
  }
  for (const id of [...plan.layers.diy, ...plan.layers.expert]) if (!ids.has(id)) issues.push(`layer_unknown_step:${id}`);
  if (plan.layers.doctor.length > 0) issues.push("doctor_layer_not_empty");
  for (const row of plan.priorityTable) {
    if (!ids.has(row.stepId)) issues.push(`priority_unknown_step:${row.stepId}`);
    if (Math.abs(row.score - priorityScore(row.impact, row.effort)) > 1e-6) issues.push(`priority_score_mismatch:${row.stepId}`);
  }
  if (!plan.disclaimers.includes("notMedicalAdvice")) issues.push("missing_not_medical_advice");
  return issues;
}

/** Öncelik tablosu: etki/emek azalan; eşitlikte önce az emek, sonra adım sırası. Saf. */
export function buildPriorityTable(steps: readonly Pick<StepCard, "id" | "impact" | "effort">[]): PriorityRow[] {
  return steps
    .map((s, i) => ({ row: { stepId: s.id, impact: s.impact, effort: s.effort, score: priorityScore(s.impact, s.effort) }, i }))
    .sort((a, b) => b.row.score - a.row.score || a.row.effort - b.row.effort || a.i - b.i)
    .map((x) => x.row);
}

/** Fazlar: adım sırası korunarak faz başına kimlikler. Saf. */
export function groupPhases(steps: readonly Pick<StepCard, "id" | "phase">[]): PlanV2["phases"] {
  const out: PlanV2["phases"] = { weeks_0_4: [], months_1_3: [], months_3_6: [] };
  for (const s of steps) out[s.phase].push(s.id);
  return out;
}

/** Katmanlar: doctor her zaman boş (okuma anında kuyruktan). Saf. */
export function groupLayers(steps: readonly Pick<StepCard, "id" | "tier">[]): PlanV2["layers"] {
  const out: PlanV2["layers"] = { diy: [], expert: [], doctor: [] };
  for (const s of steps) if (s.tier !== "doctor") out[s.tier].push(s.id);
  return out;
}

export function isPlanPhase(v: string): v is PlanPhase {
  return (PLAN_PHASES as readonly string[]).includes(v);
}
export function isPlanTier(v: string): v is PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(v);
}
