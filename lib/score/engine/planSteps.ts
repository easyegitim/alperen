import { BEARD_PRESETS } from "@/content/beard-presets";
import { HABITS } from "@/content/habits";
import { HAIR_PRESETS } from "@/content/hair-presets";
import { LEVERS } from "@/content/levers";
import { SKIN_STEPS } from "@/content/skin-steps";
import { SUB_KEYS_V2, type SubKey } from "@/lib/config/teaser";
import { STRUCTURAL_SUBS_H2 } from "@/lib/config/engine.h2.server";
import type { LeverKey } from "@/lib/score/contract";

// hybrid.v2 plan adımı kataloğu (K2: her kazanç bir plan adımına bağlı; K6/Ç2: adım yalnız content/ kataloğundan).
// Claude istemde bu listeden kimlik seçer; kod bilinmeyen kimliği düşürür. Saf; yeni içerik eklemez: cilt adımları,
// alışkanlıklar, kaldıraçlar (content/levers.ts) ve saç/sakal presetleri aynen kullanılır.

export type PlanStepKind = "skin_step" | "habit" | "lever" | "hair_preset" | "beard_preset";
export type PlanStepV2 = { id: string; nameTr: string; kind: PlanStepKind; subs: readonly SubKey[] };

const STRUCTURAL: readonly SubKey[] = STRUCTURAL_SUBS_H2;

/** Cilt adımlarının alt skoru: dudak ve sakal yağı bakıma, saç kremi/saç derisi saça, geri kalanı cilde. */
function skinStepSubs(id: string): readonly SubKey[] {
  if (id === "st_lip_balm" || id === "st_beard_oil") return ["grooming"];
  if (id === "st_hair_conditioner" || id === "st_scalp_scrub_weekly") return ["hair"];
  return ["skin"];
}

const LEVER_SUB_V2: Record<LeverKey, SubKey> = {
  lv_blemish_care: "skin",
  lv_texture_smooth: "skin",
  lv_daily_spf: "skin",
  lv_shine_balance: "skin",
  lv_hair_styling: "hair",
  lv_haircut_refresh: "hair",
  lv_brow_tidy: "brows",
  lv_lip_care: "grooming",
  lv_beard_lineup: "grooming",
};

export const PLAN_STEPS_V2: readonly PlanStepV2[] = [
  ...SKIN_STEPS.map((s) => ({ id: s.id, nameTr: s.nameTr, kind: "skin_step" as const, subs: skinStepSubs(s.id) })),
  ...HABITS.filter((h) => !h.weightRelated).map((h) => ({ id: h.id, nameTr: h.nameTr, kind: "habit" as const, subs: ["skin"] as const })),
  ...(Object.keys(LEVERS) as LeverKey[]).map((k) => ({
    id: k,
    nameTr: leverName(k),
    kind: "lever" as const,
    // Kaş düzeni ve sakal hattı yapısal alanların algısını da etkiler (KB §4.9 son iki satır).
    subs: k === "lv_brow_tidy" || k === "lv_beard_lineup" ? ([LEVER_SUB_V2[k], ...STRUCTURAL] as const) : ([LEVER_SUB_V2[k]] as const),
  })),
  // Stil seçimleri: saç alt skoru ve yapısal alanların algısı (bakımla değişmeyen alanda yalnız algı; kazanç 0).
  ...HAIR_PRESETS.map((p) => ({ id: p.id, nameTr: p.nameTr, kind: "hair_preset" as const, subs: ["hair", ...STRUCTURAL] as const })),
  ...BEARD_PRESETS.map((p) => ({ id: p.id, nameTr: p.nameTr, kind: "beard_preset" as const, subs: ["grooming", ...STRUCTURAL] as const })),
];

function leverName(k: LeverKey): string {
  const names: Record<LeverKey, string> = {
    lv_blemish_care: "Leke ve sivilce bakımı rutini",
    lv_texture_smooth: "Doku düzenleme rutini",
    lv_daily_spf: "Günlük güneş koruması",
    lv_shine_balance: "Parlama dengesi rutini",
    lv_hair_styling: "Günlük saç şekillendirme",
    lv_haircut_refresh: "Kesimi yenileme",
    lv_brow_tidy: "Kaş düzeni (fazlalıkları alma)",
    lv_lip_care: "Dudak bakımı",
    lv_beard_lineup: "Sakal hattı düzenleme",
  };
  return names[k];
}

export const PLAN_STEP_BY_ID: ReadonlyMap<string, PlanStepV2> = new Map(PLAN_STEPS_V2.map((s) => [s.id, s]));

/** Bu alt skor için izinli adımlar (istem listesi ve kod doğrulaması aynı kaynaktan). */
export function stepsForSub(sub: SubKey): PlanStepV2[] {
  return PLAN_STEPS_V2.filter((s) => s.subs.includes(sub));
}

export function isStepAllowed(sub: SubKey, stepId: string): boolean {
  return PLAN_STEP_BY_ID.get(stepId)?.subs.includes(sub) ?? false;
}

export function isStructuralSub(sub: SubKey): boolean {
  return STRUCTURAL.includes(sub);
}

/** Bağlama göre adım uygunluğu: başörtüsü/görünür saç yok → saç adımı yok (K9, CLAUDE.md); kadın sunumunda sakal preset'i yok. */
export type StepEligibility = { hairAllowed: boolean; beardAllowed: boolean };
export const ALL_STEPS_ELIGIBLE: StepEligibility = { hairAllowed: true, beardAllowed: true };

/** İstem listesi ve kod doğrulaması (validRaise) aynı kuralı kullanır; istem yalnız öneridir, zorlayan kod filtresidir. */
export function isStepEligible(step: PlanStepV2, opts: StepEligibility): boolean {
  if (!opts.hairAllowed && (step.kind === "hair_preset" || step.subs[0] === "hair")) return false;
  if (!opts.beardAllowed && step.kind === "beard_preset") return false;
  return true;
}

/** İstem için kompakt liste: alt skor → "id — ad" satırları. */
export function planStepsForPrompt(opts: StepEligibility): Record<SubKey, string[]> {
  return Object.fromEntries(SUB_KEYS_V2.map((k) => [k, stepsForSub(k).filter((s) => isStepEligible(s, opts)).map((s) => `${s.id} — ${s.nameTr}`)])) as Record<SubKey, string[]>;
}
