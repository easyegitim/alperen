// Plan v2 ekranı görünüm modeli (KB §6.1; PLAN 4d; CONTRACTS_V2 S2.3/S3.1). Saf; birim testli. Web components/plan/* ile
// aynı kurallar (mobil @/components/* içe aktaramaz). Plan SUNUCUDA kurulur (GET/POST /api/plan); burada yalnız sunum.
import type { PlanV2, PlanViewV2, StepCard } from "@/lib/coach/planTypes";
import { PLAN_AREAS, type PlanArea } from "@/lib/config/plan";

export type HairLossSignal = "none" | "possible" | "visible" | "not_visible" | null;
export type PlanPayload = { view: PlanViewV2; hairLossSignal: HairLossSignal };

/** Sekme sırası (KB §6.1 mock-up): Saç · Sakal · Saç rengi · Cilt · Egzersizler; sonra kaş, alışkanlık, stil (varsa). */
export const TAB_ORDER: readonly PlanArea[] = ["hair", "beard", "color", "skin", "exercise", "brows", "habit", "style"];

export function planAreas(plan: Pick<PlanV2, "steps"> | null): PlanArea[] {
  const present = new Set(plan?.steps.map((s) => s.area) ?? []);
  return TAB_ORDER.filter((a) => present.has(a) && (PLAN_AREAS as readonly string[]).includes(a));
}

export function stepsForTab(plan: Pick<PlanV2, "steps">, tab: PlanArea | "all"): StepCard[] {
  return plan.steps.filter((s) => tab === "all" || s.area === tab);
}

/** Türkçe karakter katlama (yalnız arama; lib/ai/safety mobilden içe aktarılmaz). */
export function foldTr(s: string): string {
  return s.toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ğ/g, "g").replace(/ç/g, "c").replace(/ö/g, "o").replace(/ü/g, "u").replace(/â/g, "a").replace(/î/g, "i").replace(/û/g, "u");
}

const SCALP_RE = /scalp|hair_wash/;
/** Saç derisi adımı var mı (saç dökülmesi kartı yalnız o zaman "plana eklendi" der). */
export function hasScalpStepIn(steps: readonly Pick<StepCard, "id" | "title">[]): boolean {
  return steps.some((s) => SCALP_RE.test(s.id) || foldTr(s.title).includes("sac derisi"));
}

export function hairLossOf(signal: HairLossSignal): "possible" | "visible" | null {
  return signal === "possible" || signal === "visible" ? signal : null;
}

export type CostLabel = { kind: "free" } | { kind: "from"; min: string } | { kind: "range"; min: string; max: string };
const fmtTry = (n: number) => n.toLocaleString("tr-TR");

export function costLabel(step: Pick<StepCard, "costTryRange">): CostLabel {
  const c = step.costTryRange;
  if (c.max === 0 && c.min === 0) return { kind: "free" };
  if (c.max === null) return { kind: "from", min: fmtTry(c.min) };
  return { kind: "range", min: fmtTry(c.min), max: fmtTry(c.max) };
}

/** Kaynak yalnız https ise bağlantı olur; düz atıf metin olarak basılır. */
export const isHttpsUrl = (s: string) => /^https:\/\/\S+$/i.test(s);

/** Plan hata kodu → kullanıcı eylemi (web PlanView): BAD_INPUT anketi, PREMIUM_REQUIRED ödemeyi, diğerleri tekrar denemeyi ister. */
export type PlanErrorAction = "questionnaire" | "premium" | "retry";
export function planErrorAction(code: string | null): PlanErrorAction {
  if (code === "BAD_INPUT") return "questionnaire";
  if (code === "PREMIUM_REQUIRED") return "premium";
  return "retry";
}

/** Glow-up için plan adımları (doktor katmanı hariç; KB §7.2). */
export type PlanStepLite = { id: string; title: string; area: PlanArea };
export function planStepsLite(view: Pick<PlanViewV2, "plan"> | null): PlanStepLite[] {
  if (!view) return [];
  return view.plan.steps.filter((s) => s.tier !== "doctor").map((s) => ({ id: s.id, title: s.title, area: s.area }));
}

/** "Sana önerilen" (dene galerisi): plan adımlarının tryonPresetId'leri (doktor katmanı hariç). */
export function recommendedFromPlan(view: Pick<PlanViewV2, "plan"> | null): string[] {
  if (!view) return [];
  return [...new Set(view.plan.steps.flatMap((s) => (s.tryonPresetId && s.tier !== "doctor" ? [s.tryonPresetId] : [])))];
}

/** Katman sayıları: doktor okuma anında kuyruktan (view.doctor.steps), diğerleri plandan. */
export function layerCounts(view: PlanViewV2): Record<"diy" | "expert" | "doctor", number> {
  return { diy: view.plan.layers.diy.length, expert: view.plan.layers.expert.length, doctor: view.doctor.steps.length };
}

export function exclusionEntries(plan: Pick<PlanV2, "exclusions">): { key: string; value: string }[] {
  return Object.entries(plan.exclusions).flatMap(([key, value]) => (typeof value === "string" ? [{ key, value }] : []));
}
