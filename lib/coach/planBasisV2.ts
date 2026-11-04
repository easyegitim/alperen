import type { AgeBand } from "@/lib/onboarding/age";
import type { FaceShape } from "@/lib/face/types";
import type { PlanArea } from "@/lib/config/plan";
import { exerciseEligibleV2, hairAdviceAllowedV2, resolvePhotoConfirm, type QuestionnaireV2 } from "@/lib/questionnaireV2";
import { bodyRules, type BodyRules } from "./bodyRules";
import type { KnowledgeConstraints } from "./knowledge";
import type { BasisChip, PlanExclusions } from "./planTypes";

// Plan v2 bağlamı (PLAN §3 kişiselleştirme listesi; KB §3.2/5–6, K8–K10, Ç1, Ç17). Saf, paylaşılan.
// Her anket cevabı ve fotoğraf gerçeği planda GÖRÜNÜR iz bırakır (basis çipi ya da exclusion). Boy, kilo, VKİ ve serbest
// not ASLA çip olmaz; yalnız kuralı (K8) etkiler. Skor burada yoktur ve hiçbir şey skoru değiştirmez.

export type PlanContextV2 = {
  questionnaire: QuestionnaireV2;
  presentation: "male" | "female" | "unspecified";
  ageBand: AgeBand | null;
  /** Saç/sakal süzgeci için geçerli yüz şekli: kullanıcı düzeltmesi > detaylı > ön değerlendirme (KB §4.10). */
  faceShape: FaceShape | null;
  faceShapeSource: "override" | "detailed" | "prelim" | null;
  /** Kaç açı kullanıldı (güven notu; fotoğraf yok). */
  viewsUsed: number;
  /** Fotoğrafta görünen bakım ayrıntıları (SignalsV2.observations.other; denetimden geçmiş nötr cümleler, ≤ 3). */
  photoFacts: string[];
  /** Beden algısı taraması (profiles.body_image_screen_result); null = yapılmadı. */
  bodyImageScreen: "ok" | "risk" | null;
  /** FEATURE_DOCTOR_LAYER (sunucu okur, buraya boolean gelir). */
  doctorLayerEnabled: boolean;
};

export const MAX_PHOTO_FACT_CHIPS = 3;

export function isUnder18(ageBand: AgeBand | null): boolean {
  return ageBand === "under_18";
}

/** VKİ (bir ondalık) ya da null. */
export function bmiOf(body: QuestionnaireV2["body"] | undefined): number | null {
  if (!body) return null;
  return Math.round((body.weightKg / (body.heightCm / 100) ** 2) * 10) / 10;
}

/** K8 + Ç1: yağ oranı/kalori içeriği yalnız VKİ ≥ 25, 18+, kısıtlama sinyali yokken. Nedeni exclusion olarak görünür. */
export function bodyAllowanceV2(ctx: Pick<PlanContextV2, "questionnaire" | "ageBand">): { rules: BodyRules; bodyFatAllowed: boolean; exclusion: PlanExclusions["bodyFat"] } {
  const rules = bodyRules({ bmi: bmiOf(ctx.questionnaire.body) });
  if (isUnder18(ctx.ageBand)) return { rules, bodyFatAllowed: false, exclusion: "under_18" };
  if (!ctx.questionnaire.body) return { rules, bodyFatAllowed: false, exclusion: "no_body" };
  if (rules.mode === "deficit") return { rules, bodyFatAllowed: true, exclusion: undefined };
  return { rules, bodyFatAllowed: false, exclusion: "bmi_below_25" };
}

export function beardAllowedV2(ctx: Pick<PlanContextV2, "questionnaire" | "presentation">): boolean {
  return ctx.presentation !== "female" && ctx.questionnaire.beardLengthPref !== "none";
}

/** Bilgi tabanı kısıtları (kod uygular; model görmez). */
export function constraintsFromContext(ctx: PlanContextV2): KnowledgeConstraints {
  const q = ctx.questionnaire;
  const body = bodyAllowanceV2(ctx);
  return {
    headCovering: resolvePhotoConfirm(q.headCovering),
    presentation: ctx.presentation,
    jawHealth: exerciseEligibleV2(q) ? "none" : "issue",
    beardPreference: beardAllowedV2(ctx) ? "some" : "none",
    budgetBand: q.budget,
    oneTimeBudgetBand: q.oneTimeBudget,
    timeBand: q.minutesPerDay,
    under18: isUnder18(ctx.ageBand),
    bodyFatAllowed: body.bodyFatAllowed,
    restrictionSignal: false,
    glasses: resolvePhotoConfirm(q.glasses) === true,
    // Doktor kayıtları yalnız hekim kuyruğu taslağı için ayrı çağrıda alınır; plan retrieve'inde hiçbir zaman değil.
    doctorLayer: false,
  };
}

/** Plana girebilecek alanlar (sekmeler): K9 saç/renk, sunum/tercih sakal, K10 egzersiz. */
export function areasForContext(ctx: PlanContextV2): PlanArea[] {
  const q = ctx.questionnaire;
  const out: PlanArea[] = ["skin", "brows", "habit", "style"];
  if (hairAdviceAllowedV2(q)) out.unshift("hair", "color");
  if (beardAllowedV2(ctx)) out.splice(out.indexOf("skin"), 0, "beard");
  if (exerciseEligibleV2(q)) out.push("exercise");
  return out;
}

/** Bilerek atlanan bölümler ve nedenleri (tr.json plan.v2.exclusions.*). */
export function exclusionsV2(ctx: PlanContextV2): PlanExclusions {
  const q = ctx.questionnaire;
  const out: PlanExclusions = {};
  const hc = resolvePhotoConfirm(q.headCovering);
  if (hc === true) out.hair = "head_covering";
  else if (hc === null) out.hair = "head_covering_unknown";
  if (ctx.presentation === "female") out.beard = "presentation";
  else if (q.beardLengthPref === "none") out.beard = "preference";
  if (!exerciseEligibleV2(q)) out.exercises = "jaw_health";
  const body = bodyAllowanceV2(ctx);
  if (body.exclusion) out.bodyFat = body.exclusion;
  return out;
}

const yesNo = (v: boolean | null): string | undefined => (v === null ? undefined : v ? "yes" : "no");

/** "Planın şunlara göre hazırlandı" çipleri: HER cevap ve fotoğraf gerçeği (PLAN §3). Boy/kilo/VKİ yok. En çok 30. */
export function basisChipsV2(ctx: PlanContextV2): BasisChip[] {
  const q = ctx.questionnaire;
  const chips: BasisChip[] = [];
  for (const g of q.goals) chips.push({ key: "goal", value: g, source: "questionnaire" });
  chips.push({ key: "goalDirection", value: q.goalDirection, source: "questionnaire" });
  chips.push({ key: "budget", value: q.budget, source: "questionnaire" });
  if (q.oneTimeBudget !== "unknown") chips.push({ key: "oneTimeBudget", value: q.oneTimeBudget, source: "questionnaire" });
  chips.push({ key: "minutes", value: String(q.minutesPerDay), source: "questionnaire" });
  chips.push({ key: "sportDays", value: q.activity.sportDays, source: "questionnaire" });
  chips.push({ key: "work", value: q.activity.work, source: "questionnaire" });
  if (hairAdviceAllowedV2(q)) chips.push({ key: "hairLength", value: q.hairLengthPref, source: "questionnaire" });
  if (ctx.presentation !== "female") chips.push({ key: "beardLength", value: q.beardLengthPref, source: "questionnaire" });
  chips.push({ key: "skinType", value: q.skinType, source: "questionnaire" });
  // Çene sağlığı: koşullar listelenmez (sağlık verisi); tek genel çip, yalnız egzersiz eklenmediğinde.
  if (!exerciseEligibleV2(q)) chips.push({ key: "jawHealth", source: "questionnaire" });
  const glasses = resolvePhotoConfirm(q.glasses);
  if (glasses !== null) chips.push({ key: "glasses", value: yesNo(glasses), source: q.glasses.value === null ? "photo" : "questionnaire" });
  const hc = resolvePhotoConfirm(q.headCovering);
  if (hc !== null) chips.push({ key: "headCovering", value: yesNo(hc), source: q.headCovering.value === null ? "photo" : "questionnaire" });
  if (ctx.faceShape) chips.push({ key: "faceShape", value: ctx.faceShape, source: ctx.faceShapeSource === "override" ? "profile" : ctx.faceShapeSource === "detailed" ? "photo" : "device" });
  if (ctx.ageBand) chips.push({ key: "ageBand", value: ctx.ageBand, source: "profile" });
  chips.push({ key: "presentation", value: ctx.presentation, source: "profile" });
  for (const f of ctx.photoFacts.slice(0, MAX_PHOTO_FACT_CHIPS)) chips.push({ key: "photoFact", value: f.slice(0, 120), source: "photo" });
  if (ctx.viewsUsed > 0) chips.push({ key: "viewsUsed", value: String(ctx.viewsUsed), source: "photo" });
  return chips.slice(0, 30);
}
