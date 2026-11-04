import { z } from "zod";
import { BEARD_PRESETS } from "@/content/beard-presets";
import { COLOR_PRESETS } from "@/content/color-presets";
import { EXERCISES } from "@/content/exercises";
import { HABITS } from "@/content/habits";
import { HAIR_PRESETS } from "@/content/hair-presets";
import { SKIN_STEPS } from "@/content/skin-steps";
import { BUDGET_BAND_TRY, EVIDENCE_FROM_GRADE, EVIDENCE_LEVELS, ONE_TIME_BUDGET_BAND_TRY, PLAN_AREAS, PLAN_TIERS, type BudgetBand, type GoalDirection, type OneTimeBudgetBand, type PlanArea, type PlanTier, type TimeBand } from "@/lib/config/plan";
import { normalizeTr } from "@/lib/ai/safety";
import type { FaceShape } from "@/lib/face/types";
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
  "female_presentation", // sakal içeriği ve yalnız erkek sunumu için tanımlı stiller (preset.presentation ["male"]) yok
  "male_presentation", // yalnız kadın sunumu için tanımlı stiller (preset.presentation ["female"]) erkek sunumunda yok
  "no_beard_preference", // sakal tercihi "yok"
  "under_18", // Ç1: doktor katmanı, yağ oranı, oruç yok
  "bmi_below_25", // K8
  "restriction_signal", // bodyRules: kısıtlama sinyali
  "glasses", // gözlük çerçevesiyle uyumsuz stil (nadir)
] as const;
export type Contraindication = (typeof CONTRAINDICATIONS)[number];

/** Yüz şekli kimlikleri (lib/face/types FaceShape ile birebir; saç/sakal kaydı `faceShapes` için). */
export const FACE_SHAPE_IDS = ["oval", "round", "square", "long", "heart", "diamond"] as const satisfies readonly FaceShape[];

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
  /** Saç/sakal stili hangi yüz şekillerine uyar (preset.suits); boş/yok = her şekle. Kod süzer (PLAN §3). */
  faceShapes: z.array(z.enum(FACE_SHAPE_IDS)).max(FACE_SHAPE_IDS.length).optional(),
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
  /** Tek seferlik uzman/klinik bandı (anket); yoksa "unknown" (süzgeç yok). Tek seferlik kayıtların ilgi puanında. */
  oneTimeBudgetBand?: OneTimeBudgetBand;
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
  /** Geçerli yüz şekli (kullanıcı düzeltmesi > detaylı > ön); null/yok = süzgeç yok. Saç/sakal kayıtları buna göre süzülür. */
  faceShape?: FaceShape | null;
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
  if (c.presentation === "male") active.add("male_presentation");
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

/** Kayıt yüz şekline uyuyor mu (saf): şekil bilinmiyorsa ya da kayıt şekil listesi taşımıyorsa evet. */
export function matchesFaceShape(r: Pick<MethodRecord, "faceShapes">, faceShape: FaceShape | null | undefined): boolean {
  if (!faceShape || !r.faceShapes || r.faceShapes.length === 0) return true;
  return r.faceShapes.includes(faceShape);
}

/**
 * Tek seferlik adım (kesim, uzman, klinik) tek seferlik bütçe bandını aşıyor mu (saf; PLAN §3 bütçe → ₺):
 * "unknown" → süzgeç yok; "none" (şimdilik yok) → aylık bandın üst sınırı geçerli; üst sınırı açık bant → aşmaz.
 */
export function exceedsOneTimeBudget(cost: { min: number; max: number | null }, oneTime: OneTimeBudgetBand, monthly: BudgetBand): boolean {
  if (oneTime === "unknown") return false;
  const max = oneTime === "none" ? BUDGET_BAND_TRY[monthly].max : (ONE_TIME_BUDGET_BAND_TRY[oneTime]?.max ?? null);
  if (max === null) return false;
  return cost.min > max;
}

const budgetRank: Record<BudgetBand, number> = { upto_1000: 0, "1000_2500": 1, "2500_5000": 2, "5000_plus": 3 };
const costRank: Record<CostBand, number> = { none: 0, low: 0, medium: 1, high: 2 };

/** Eşleşmede anlam taşımayan kısa Türkçe sözcükler (normalize); üç harfli etiketler ("spf", "ton") ise eşleşir. */
const STOPWORDS: ReadonlySet<string> = new Set(["bir", "ile", "her", "icin", "ama", "gibi", "daha", "olan", "veya", "cok", "iki", "bu", "ve", "de", "da", "ne", "mi", "mu", "ya", "en", "az", "kez", "gun"]);

/** Gözlem ve etiket sözcükleri: normalize, ≥ 3 harf, durak sözcükler dışarıda (saf). */
export function tokenizeTr(s: string): string[] {
  return normalizeTr(s)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/** Hedef yönü (KB Ö7) → stil etiketleri: "daha keskin ve olgun" kesim/sakal setine, "daha yumuşak ve genç" yumuşak dokuya yaklaşır. */
const DIRECTION_TAGS: Record<GoalDirection, string[]> = {
  sharper_mature: ["keskin", "belirgin", "kutu", "fade", "taper", "sert", "cizgi", "hat"],
  softer_younger: ["yumusak", "dalgali", "hacim", "dogal", "hafif", "kakul", "sakalsiz"],
  as_is_groomed: ["duzen", "bakim", "temiz", "tazele", "hafif"],
};

/**
 * İlgi puanı (saf): alan eşleşmesi + bölge eşleşmesi + gözlem/etiket kelime örtüşmesi + hedef + hedef yönü + bütçe uyumu
 * + süre uyumu. W4 (Sprint 2): yön etiketleri, süre payı ve bölge ağırlığı eklendi; arayüz değişmedi.
 */
export function relevanceScore(r: MethodRecord, q: KnowledgeQuery): number {
  let s = 0;
  if (q.areas.includes(r.area)) s += 3;
  const regionHits = q.regions?.filter((k) => r.regions.includes(k)).length ?? 0;
  if (regionHits > 0) s += 2 + Math.min(1, regionHits - 1) * 0.5;
  const words = new Set(q.observations.flatMap(tokenizeTr));
  let tagHits = 0;
  // Çok sözcüklü etiket ("sac derisi") tüm sözcükleri gözlemde geçince eşleşir; tek sözcük ("spf") doğrudan.
  for (const t of r.tags) {
    const toks = tokenizeTr(t);
    if (toks.length > 0 && toks.every((w) => words.has(w))) tagHits += 1;
  }
  s += Math.min(3, tagHits) * 2;
  if (q.goals.includes("general")) s += 0.5;
  const goalArea: Partial<Record<(typeof GOALS)[number], PlanArea[]>> = { hair: ["hair", "color"], beard: ["beard"], skin: ["skin"], face_contours: ["exercise", "habit"], style: ["style", "hair", "beard"] };
  for (const g of q.goals) if (goalArea[g]?.includes(r.area)) s += 1.5;
  if (q.goalDirection && (r.area === "hair" || r.area === "beard" || r.area === "color")) {
    const dir = DIRECTION_TAGS[q.goalDirection];
    const n = normalizeTr(`${r.title} ${r.summary} ${r.tags.join(" ")}`);
    if (dir.some((d) => n.includes(d))) s += 1;
  }
  if (costRank[r.costBand] <= budgetRank[q.constraints.budgetBand]) s += 1;
  else s -= 2;
  if (r.frequency.per === "once" && q.constraints.oneTimeBudgetBand && exceedsOneTimeBudget(r.costTryRange ?? COST_BAND_TRY[r.costBand], q.constraints.oneTimeBudgetBand, q.constraints.budgetBand)) s -= 2;
  // Günlük adımda süre payı: kullanıcının bandının yarısından azı önde (bütçe gibi; aşanlar zaten filtrelendi).
  if (r.frequency.per === "day" && r.minutesPerDay <= q.constraints.timeBand / 2) s += 0.5;
  if (r.evidence.level === "many_studies") s += 0.5;
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

const tr = tokenizeTr;

/** Katalog alanı → ilgili rapor bölgeleri (yapısal bölge yalnız algı/stil alanında; planTypes STRUCTURAL_REGIONS). */
const AREA_REGIONS: Record<PlanArea, RegionKey[]> = {
  hair: ["hair"],
  beard: ["beard", "jawline"],
  color: ["hair"],
  skin: ["skin"],
  brows: ["brows", "eyeArea"],
  exercise: ["skin"],
  habit: ["skin"],
  style: ["eyeArea"],
};

function skinStepRecord(s: (typeof SKIN_STEPS)[number]): MethodRecord {
  const area: PlanArea = s.area ?? "skin";
  const regions: RegionKey[] = s.id === "st_eye_area" ? ["eyeArea", "skin"] : s.id === "st_lip_balm" ? ["lipsSmile"] : s.id === "st_nose_ear_trim" ? ["nose", "brows"] : AREA_REGIONS[area];
  const contraindications: Contraindication[] =
    area === "hair" ? ["head_covering", "head_covering_unknown"] : area === "beard" ? ["female_presentation", "no_beard_preference"] : s.id === "st_glasses_clean" ? [] : [];
  const grade = s.evidence ?? "C";
  return {
    id: s.id,
    area,
    title: s.nameTr,
    summary: s.noteTr,
    tier: "diy",
    evidence: { level: EVIDENCE_FROM_GRADE[grade], grade },
    costBand: s.budget,
    costTryRange: COST_BAND_TRY[s.budget],
    frequency: s.slot === "weekly" ? { per: "week", times: 1 } : { per: "day", times: 1 },
    minutesPerDay: s.slot === "weekly" ? Math.max(1, Math.round(s.minutes / 7)) : s.minutes,
    difficulty: 1,
    impact: s.id === "st_spf" ? 3 : 2,
    effort: 1,
    tags: [...new Set([...tr(s.nameTr), ...tr(s.noteTr), ...(s.id === "st_glasses_clean" ? ["gozluk"] : [])])],
    regions,
    contraindications,
    flawIds: [],
    source: { kind: "catalog", ref: `content/skin-steps.ts#${s.id}` },
  };
}

function habitRecord(h: (typeof HABITS)[number]): MethodRecord {
  const hair = h.area === "hair";
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
    regions: hair ? ["hair"] : ["skin"],
    // K8/Ç1: kilo ile ilgili alışkanlıklar yalnız VKİ ≥ 25 ve 18+ (hb_strength hariç: her modda kalır, catalog.ts ile aynı);
    // K9: saç alışkanlığı başörtüsüyle plana girmez.
    contraindications: h.weightRelated && h.id !== "hb_strength" ? ["bmi_below_25", "under_18", "restriction_signal"] : hair ? ["head_covering", "head_covering_unknown"] : [],
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
    // Egzersiz yapısal bölgeye (çene, yanak) bağlanamaz (planTypes kural 2): gözlem bağı cilt/şişlik üzerinden kurulur.
    regions: ["skin"],
    contraindications: ["jaw_health_issue"],
    flawIds: [],
    source: { kind: "catalog", ref: `content/exercises.ts#${e.id}` },
  };
}

type Preset = (typeof HAIR_PRESETS)[number];
/** Preset → kayıt. Gizli (sürüm kapısı, KB §7.3/4) preset kayıt olmaz; sunum ve yüz şekli (suits) kodla süzülür (PLAN §3). */
function presetRecord(p: Preset, area: "hair" | "beard" | "color"): MethodRecord | null {
  if (p.hidden) return null;
  const pres = p.presentation ?? [];
  const presentationContra: Contraindication[] = pres.length === 1 ? (pres[0] === "male" ? ["female_presentation"] : ["male_presentation"]) : [];
  const base: Contraindication[] = area === "beard" ? ["female_presentation", "no_beard_preference"] : ["head_covering", "head_covering_unknown"];
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
    contraindications: [...new Set<Contraindication>([...base, ...presentationContra])],
    flawIds: [],
    tryonPresetId: p.id,
    ...(p.suits.length > 0 ? { faceShapes: [...p.suits] } : {}),
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
  ].filter((r): r is MethodRecord => r !== null);
}

/** İlk sürüm bilgi tabanı: SPEC katalogları + etiket/anahtar kelime eşleşmesi. W4 retrieve sıralamasını iyileştirebilir. */
export class CatalogKnowledgeSource implements KnowledgeSource {
  readonly name: "catalog" | "methods";
  private readonly records: MethodRecord[];
  private readonly byId: Map<string, MethodRecord>;

  constructor(records: readonly MethodRecord[] = catalogMethodRecords(), name: "catalog" | "methods" = "catalog") {
    this.name = name;
    this.records = [...records];
    this.byId = new Map(this.records.map((r) => [r.id, r]));
  }

  /**
   * Kısıtlar (K8/K9/K10/Ç1/Ç17) + izinli alanlar + yüz şekli KODLA süzülür, sonra ilgiye göre sıralanır: model yalnız
   * uygulanabilir kayıtları görür (CONTRACTS_V2 S2.2); alan dışı kayıt ≤ 40 bütçesini harcamaz.
   */
  async retrieve(q: KnowledgeQuery, limit = KNOWLEDGE_RETRIEVE_LIMIT): Promise<MethodRecord[]> {
    const n = Math.max(1, Math.min(KNOWLEDGE_RETRIEVE_LIMIT, limit));
    return filterByConstraints(this.records, q.constraints)
      .filter((r) => (q.areas.length === 0 || q.areas.includes(r.area)) && matchesFaceShape(r, q.faceShape))
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

  /** Tüm kayıtlar (eşzamanlı; sabit veri ve testler için). */
  allRecords(): readonly MethodRecord[] {
    return this.records;
  }
}

/**
 * TSV'den içe aktarılmış yöntem kütüphanesi (content/methods/*.json; scripts/import-methods.ts). AYNI arayüz: Claude ve plan
 * kurucu kaynağın hangisi olduğunu bilmez. Kayıtlar MethodsFile şemasından geçmemişse dosya atlanır (uydurma kayıt yok).
 */
export class MethodsKnowledgeSource extends CatalogKnowledgeSource {
  constructor(files: readonly MethodsFile[], includeCatalog = true) {
    const fromFiles = files.flatMap((f) => (MethodsFile.safeParse(f).success ? f.records : []));
    const seen = new Set(fromFiles.map((r) => r.id));
    super([...fromFiles, ...(includeCatalog ? catalogMethodRecords().filter((r) => !seen.has(r.id)) : [])], "methods");
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
