import { z } from "zod";
import { BEARD_PRESETS } from "@/content/beard-presets";
import { COLOR_PRESETS } from "@/content/color-presets";
import { EXERCISES } from "@/content/exercises";
import { HABITS } from "@/content/habits";
import { HAIR_PRESETS } from "@/content/hair-presets";
import { SKIN_STEPS } from "@/content/skin-steps";
import { EVIDENCE_LEVELS, PLAN_AREAS, PLAN_TIERS, type BudgetBand, type GoalDirection, type PlanArea, type PlanTier, type TimeBand } from "@/lib/config/plan";
import { normalizeTr } from "@/lib/ai/safety";
import type { GOALS } from "@/lib/questionnaire";
import { REGION_KEYS, type RegionKey } from "@/lib/score/contract";
import { CostTryRange, Evidence, StepFrequency } from "./planTypes";

// Bilgi tabanı arayüzü (PLAN_V2 Faz 0 "TSV bilgi tabanı"; KB Ç2, §6.1–6.3). Saf, paylaşılan.
// İlk sürüm: SPEC katalogları (content/*) + etiket/anahtar kelime eşleşmesi (CatalogKnowledgeSource).
// TSV geldiğinde: scripts/import-methods.ts (W4/Sprint 3) → content/methods/*.json → MethodsKnowledgeSource AYNI arayüzle.
// İleride embedding tabanlı erişim de aynı arayüzün arkasına eklenir. Claude'a istemde yalnız ilgili kayıtlar
// (en çok KNOWLEDGE_RETRIEVE_LIMIT) verilir; kimlikleri birebir kullanır; kod bilinmeyen kimliği düşürür (validateMethodIds).

export const KNOWLEDGE_RETRIEVE_LIMIT = 40;

/** Kayıt düzeyinde kısıtlar: anket/profil cevabı eşleşirse kayıt dışarıda kalır (kod uygular, model görmez). */
export const CONTRAINDICATIONS = [
  "head_covering", // K9: başörtüsü → saç/renk yok
  "head_covering_unknown", // Ç17: tahmin ve seçim yoksa saç önerisi üretilmez
  "jaw_health_issue", // K10: çene sağlığı "hiçbiri" değilse egzersiz yok
  "female_presentation", // sakal içeriği yok
  "no_beard_preference", // sakal tercihi "yok"
  "under_18", // Ç1: doktor katmanı, yağ oranı, oruç yok
  "bmi_below_25", // K8
  "restriction_signal", // bodyRules: kısıtlama sinyali
  "glasses", // gözlük çerçevesiyle uyumsuz stil (nadir)
] as const;
export type Contraindication = (typeof CONTRAINDICATIONS)[number];

export const COST_BANDS = ["none", "low", "medium", "high"] as const;
export type CostBand = (typeof COST_BANDS)[number];

/** CLAUDE NOTU: katalog bantları için TL aralıkları (yer tutucu; TSV cost_min/cost_max gelince kayıt kendi değerini taşır). */
export const COST_BAND_TRY: Record<CostBand, { min: number; max: number | null }> = {
  none: { min: 0, max: 0 },
  low: { min: 0, max: 500 },
  medium: { min: 500, max: 2000 },
  high: { min: 2000, max: null },
};

export const MethodRecord = z.object({
  id: z.string().min(1).max(80),
  area: z.enum(PLAN_AREAS),
  /** Kullanıcıya görünen nötr ad (iç taksonomi adı değil). */
  title: z.string().min(1).max(120),
  summary: z.string().max(400),
  tier: z.enum(PLAN_TIERS),
  evidence: Evidence.extend({ grade: z.enum(["A", "B", "C"]).optional() }),
  costBand: z.enum(COST_BANDS),
  costTryRange: CostTryRange.optional(),
  frequency: StepFrequency,
  minutesPerDay: z.number().min(0).max(180),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  impact: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  effort: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** Eşleşme etiketleri (küçük harf, Türkçe karakter normalize; ör. "parlama", "sivilce", "kesim"). */
  tags: z.array(z.string().max(40)).max(20),
  /** İlgili rapor bölgeleri. */
  regions: z.array(z.enum(REGION_KEYS)).max(REGION_KEYS.length),
  contraindications: z.array(z.enum(CONTRAINDICATIONS)).max(CONTRAINDICATIONS.length),
  /** TDB kusur taksonomisi kimlikleri (660'lık dosya); katalog kayıtlarında boş. */
  flawIds: z.array(z.string().max(40)).max(20),
  /** "Dene" bağı: content/presets kimliği. */
  tryonPresetId: z.string().max(80).optional(),
  source: z.object({ kind: z.enum(["catalog", "tsv"]), ref: z.string().max(120) }),
});
export type MethodRecord = z.infer<typeof MethodRecord>;

export type KnowledgeConstraints = {
  /** null = bilinmiyor (tahmin yok, seçim yok) → saç/renk kaydı verilmez (Ç17). */
  headCovering: boolean | null;
  presentation: "male" | "female" | "unspecified";
  jawHealth: "none" | "issue";
  beardPreference: "none" | "some";
  budgetBand: BudgetBand;
  timeBand: TimeBand;
  under18: boolean;
  /** K8 kuralı sonucu (bodyRules): true ise yağ oranı/kalori kaydı verilebilir. */
  bodyFatAllowed: boolean;
  restrictionSignal: boolean;
  glasses: boolean;
  /** Doktor katmanı kayıtları yalnız flag açık + 18+ + tarama "ok" iken alınır (yalnız hekim kuyruğu için). */
  doctorLayer: boolean;
};

export type KnowledgeQuery = {
  /** Rapordan gelen nötr gözlem cümleleri (ReportV3 regions.seen/improvements, SignalsV2.observations.other). */
  observations: string[];
  areas: PlanArea[];
  regions?: RegionKey[];
  goals: (typeof GOALS)[number][];
  goalDirection?: GoalDirection;
  constraints: KnowledgeConstraints;
};

export interface KnowledgeSource {
  readonly name: "catalog" | "methods";
  /** Kısıtları uygular, ilgiye göre sıralar, en çok limit kayıt döner (varsayılan KNOWLEDGE_RETRIEVE_LIMIT). */
  retrieve(q: KnowledgeQuery, limit?: number): Promise<MethodRecord[]>;
  get(id: string): Promise<MethodRecord | null>;
  /** Tüm kimlikler (doğrulama için). */
  ids(): Promise<ReadonlySet<string>>;
}

/** Kısıt uygulaması (saf). Kayıt, kullanıcının durumuyla çakışan bir kontrendikasyon taşıyorsa düşer. */
export function filterByConstraints(records: readonly MethodRecord[], c: KnowledgeConstraints): MethodRecord[] {
  const active = new Set<Contraindication>();
  if (c.headCovering === true) active.add("head_covering");
  if (c.headCovering === null) active.add("head_covering_unknown");
  if (c.jawHealth === "issue") active.add("jaw_health_issue");
  if (c.presentation === "female") active.add("female_presentation");
  if (c.beardPreference === "none") active.add("no_beard_preference");
  if (c.under18) active.add("under_18");
  if (!c.bodyFatAllowed) active.add("bmi_below_25");
  if (c.restrictionSignal) active.add("restriction_signal");
  if (c.glasses) active.add("glasses");
  return records.filter((r) => {
    if (r.tier === "doctor" && !c.doctorLayer) return false;
    if (r.contraindications.some((x) => active.has(x))) return false;
    if (r.minutesPerDay > c.timeBand && r.frequency.per === "day") return false;
    return true;
  });
}

const budgetRank: Record<BudgetBand, number> = { upto_1000: 0, "1000_2500": 1, "2500_5000": 2, "5000_plus": 3 };
const costRank: Record<CostBand, number> = { none: 0, low: 0, medium: 1, high: 2 };

/** İlgi puanı (saf): alan eşleşmesi + bölge eşleşmesi + gözlem/etiket kelime örtüşmesi + hedef + bütçe uyumu. */
export function relevanceScore(r: MethodRecord, q: KnowledgeQuery): number {
  let s = 0;
  if (q.areas.includes(r.area)) s += 3;
  if (q.regions?.some((k) => r.regions.includes(k))) s += 2;
  const words = new Set(q.observations.flatMap((o) => normalizeTr(o).split(/[^a-z0-9]+/).filter((w) => w.length > 3)));
  for (const t of r.tags) if (words.has(normalizeTr(t))) s += 2;
  if (q.goals.includes("general")) s += 0.5;
  const goalArea: Partial<Record<(typeof GOALS)[number], PlanArea[]>> = { hair: ["hair", "color"], beard: ["beard"], skin: ["skin"], face_contours: ["exercise", "habit"], style: ["style", "hair", "beard"] };
  for (const g of q.goals) if (goalArea[g]?.includes(r.area)) s += 1.5;
  if (costRank[r.costBand] <= budgetRank[q.constraints.budgetBand]) s += 1;
  else s -= 2;
  return s;
}

/** Kod doğrulaması: Claude'un seçtiği kimliklerden bilinmeyenler düşer; sıra korunur, tekrarlar tekilleşir. */
export function validateMethodIds(ids: readonly string[], known: ReadonlySet<string>): { valid: string[]; dropped: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const dropped: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    (known.has(id) ? valid : dropped).push(id);
  }
  return { valid, dropped };
}

// ─── SPEC katalogları üzerinden ilk sürüm ──────────────────────────────────────────────────────────────────────
// CLAUDE NOTU: katalog öğelerinin kanıt, etki, emek ve maliyet değerleri burada VARSAYILANDIR (TSV'de A/B/C ve
// maliyet gelince MethodsKnowledgeSource gerçek değerleri taşır). Kanıt varsayılanı "expert_opinion"; yalnız günlük
// SPF "many_studies" (güneş korumasının cilt yaşlanması kanıtı yaygın ve tartışmasızdır).

const tr = (s: string) => normalizeTr(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3);

function skinStepRecord(s: (typeof SKIN_STEPS)[number]): MethodRecord {
  const isHair = s.id === "st_hair_conditioner" || s.id === "st_scalp_scrub_weekly";
  const isBeard = s.id === "st_beard_oil";
  const area: PlanArea = isHair ? "hair" : isBeard ? "beard" : "skin";
  const regions: RegionKey[] = isHair ? ["hair"] : isBeard ? ["beard"] : s.id === "st_eye_area" ? ["eyeArea", "skin"] : s.id === "st_lip_balm" ? ["lipsSmile"] : ["skin"];
  return {
    id: s.id,
    area,
    title: s.nameTr,
    summary: s.noteTr,
    tier: "diy",
    evidence: { level: s.id === "st_spf" ? "many_studies" : "expert_opinion" },
    costBand: s.budget,
    costTryRange: COST_BAND_TRY[s.budget],
    frequency: s.slot === "weekly" ? { per: "week", times: 1 } : { per: "day", times: 1 },
    minutesPerDay: s.slot === "weekly" ? Math.max(1, Math.round(s.minutes / 7)) : s.minutes,
    difficulty: 1,
    impact: s.id === "st_spf" ? 3 : 2,
    effort: 1,
    tags: [...new Set([...tr(s.nameTr), ...tr(s.noteTr)])],
    regions,
    contraindications: isHair ? ["head_covering", "head_covering_unknown"] : isBeard ? ["female_presentation", "no_beard_preference"] : [],
    flawIds: [],
    source: { kind: "catalog", ref: `content/skin-steps.ts#${s.id}` },
  };
}

function habitRecord(h: (typeof HABITS)[number]): MethodRecord {
  return {
    id: h.id,
    area: "habit",
    title: h.nameTr,
    summary: h.defaultTargetTr,
    tier: "diy",
    evidence: { level: h.id === "hb_sun" ? "many_studies" : "expert_opinion" },
    costBand: "none",
    costTryRange: COST_BAND_TRY.none,
    frequency: h.slot === "weekly" ? { per: "week", times: 2 } : { per: "day", times: 1 },
    minutesPerDay: h.id === "hb_walk" ? 30 : h.id === "hb_strength" ? 15 : 0,
    difficulty: h.weightRelated ? 2 : 1,
    impact: 2,
    effort: h.weightRelated ? 2 : 1,
    tags: [...new Set([...tr(h.nameTr), ...tr(h.defaultTargetTr)])],
    regions: ["skin", "cheeks"],
    // K8/Ç1: kilo ile ilgili alışkanlıklar yalnız VKİ ≥ 25 ve 18+ (hb_strength hariç: her modda kalır, catalog.ts ile aynı)
    contraindications: h.weightRelated && h.id !== "hb_strength" ? ["bmi_below_25", "under_18", "restriction_signal"] : [],
    flawIds: [],
    source: { kind: "catalog", ref: `content/habits.ts#${h.id}` },
  };
}

function exerciseRecord(e: (typeof EXERCISES)[number]): MethodRecord {
  const secs = "seconds" in e.timer ? e.timer.seconds * (e.timer.sets ?? 1) : (e.timer.reps * (e.timer.holdSeconds ?? 3) * (e.timer.sets ?? 1));
  return {
    id: e.id,
    area: "exercise",
    title: e.nameTr,
    summary: `${e.doseTr}. ${e.noteTr}`,
    tier: "diy",
    evidence: { level: "expert_opinion" },
    costBand: "none",
    costTryRange: COST_BAND_TRY.none,
    frequency: { per: "day", times: 1 },
    minutesPerDay: Math.max(1, Math.round(secs / 60)),
    difficulty: 1,
    impact: 1,
    effort: 1,
    tags: [...new Set([...tr(e.nameTr), ...tr(e.noteTr), e.kind])],
    regions: e.kind === "jaw" || e.kind === "posture" ? ["jawline"] : ["cheeks", "skin"],
    contraindications: ["jaw_health_issue"],
    flawIds: [],
    source: { kind: "catalog", ref: `content/exercises.ts#${e.id}` },
  };
}

type Preset = (typeof HAIR_PRESETS)[number];
function presetRecord(p: Preset, area: "hair" | "beard" | "color"): MethodRecord {
  return {
    id: p.id,
    area,
    title: p.nameTr,
    summary: p.noteTr ?? "",
    tier: "expert",
    evidence: { level: "expert_opinion" },
    costBand: area === "color" ? "medium" : "low",
    costTryRange: COST_BAND_TRY[area === "color" ? "medium" : "low"],
    frequency: area === "color" ? { per: "month", times: 1 } : { per: "once", times: 1 },
    minutesPerDay: 0,
    difficulty: 1,
    impact: 2,
    effort: 1,
    tags: [...new Set([...tr(p.nameTr), ...(p.noteTr ? tr(p.noteTr) : []), ...p.suits])],
    regions: area === "beard" ? ["beard", "jawline"] : ["hair"],
    contraindications: area === "beard" ? ["female_presentation", "no_beard_preference"] : ["head_covering", "head_covering_unknown"],
    flawIds: [],
    tryonPresetId: p.id,
    source: { kind: "catalog", ref: `content/${area}-presets.ts#${p.id}` },
  };
}

/** content/* kataloglarından üretilen kayıtlar (saf; her çağrıda aynı). */
export function catalogMethodRecords(): MethodRecord[] {
  return [
    ...SKIN_STEPS.map(skinStepRecord),
    ...HABITS.map(habitRecord),
    ...EXERCISES.map(exerciseRecord),
    ...HAIR_PRESETS.map((p) => presetRecord(p, "hair")),
    ...BEARD_PRESETS.map((p) => presetRecord(p, "beard")),
    ...COLOR_PRESETS.map((p) => presetRecord(p, "color")),
  ];
}

/** İlk sürüm bilgi tabanı: SPEC katalogları + etiket/anahtar kelime eşleşmesi. W4 retrieve sıralamasını iyileştirebilir. */
export class CatalogKnowledgeSource implements KnowledgeSource {
  readonly name = "catalog" as const;
  private readonly records: MethodRecord[];
  private readonly byId: Map<string, MethodRecord>;

  constructor(records: readonly MethodRecord[] = catalogMethodRecords()) {
    this.records = [...records];
    this.byId = new Map(this.records.map((r) => [r.id, r]));
  }

  async retrieve(q: KnowledgeQuery, limit = KNOWLEDGE_RETRIEVE_LIMIT): Promise<MethodRecord[]> {
    const n = Math.max(1, Math.min(KNOWLEDGE_RETRIEVE_LIMIT, limit));
    return filterByConstraints(this.records, q.constraints)
      .map((r, i) => ({ r, s: relevanceScore(r, q), i }))
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, n)
      .map((x) => x.r);
  }

  async get(id: string): Promise<MethodRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async ids(): Promise<ReadonlySet<string>> {
    return new Set(this.byId.keys());
  }
}

// ─── TSV sütun sözleşmesi (VARSAYIM; dosyalar gelmedi — KB §11, PLAN §4.1) ───────────────────────────────────────
// scripts/import-methods.ts (Sprint 3) bu sütunları okur, MethodRecord'a çevirir, content/methods/*.json yazar.
// Sütun adları ekip dosyasıyla DEĞİŞEBİLİR: içe aktarma betiği başlık satırını bu sözleşmeyle eşleştirir, eksik
// zorunlu sütunda durur ve raporlar; uydurmaz. "user_label_tr" iç taksonomi adının nötr karşılığıdır (KB §5 ÖNERİ).

export const TSV_METHOD_COLUMNS = {
  required: ["id", "area", "title_tr", "summary_tr", "tier", "evidence_grade", "cost_band", "frequency_per", "frequency_times", "minutes_per_day", "difficulty", "impact", "effort"] as const,
  optional: ["source_url", "cost_min_try", "cost_max_try", "tags", "regions", "contraindications", "flaw_ids", "tryon_preset_id", "user_label_tr", "notes_internal"] as const,
  /** Liste sütunları ";" ile ayrılır. */
  listSeparator: ";",
  /** evidence_grade A|B|C → EVIDENCE_FROM_GRADE; area ∈ PLAN_AREAS; tier ∈ PLAN_TIERS; cost_band ∈ COST_BANDS. */
  enums: { area: PLAN_AREAS, tier: PLAN_TIERS, evidence: EVIDENCE_LEVELS, costBand: COST_BANDS, contraindications: CONTRAINDICATIONS, regions: REGION_KEYS },
} as const;

/** 660'lık kusur taksonomisi (VARSAYIM): bölge + iç ad + nötr kullanıcı adı + yöntem bağları. İç ad rapora geçmez. */
export const TSV_FLAW_COLUMNS = {
  required: ["flaw_id", "region", "internal_name_tr", "user_label_tr"] as const,
  optional: ["tags", "method_ids", "notes_internal"] as const,
  listSeparator: ";",
} as const;

/** content/methods/*.json dosya biçimi: { version, importedAt, sourceFile, records: MethodRecord[] }. */
export const MethodsFile = z.object({
  version: z.literal("methods.v1"),
  importedAt: z.string(),
  sourceFile: z.string().max(200),
  records: z.array(MethodRecord),
});
export type MethodsFile = z.infer<typeof MethodsFile>;

export function isPlanTierValue(v: string): v is PlanTier {
  return (PLAN_TIERS as readonly string[]).includes(v);
}
