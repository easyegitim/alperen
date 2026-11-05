// Rapor promptuna giden filtrelenmiş kataloglar (SPEC 9.8 kural 3: yalnız verilen listelerden seçilir).
import { BEARD_PRESETS } from "@/content/beard-presets";
import { COLOR_PRESETS } from "@/content/color-presets";
import { EXERCISES } from "@/content/exercises";
import { HABITS } from "@/content/habits";
import { HAIR_PRESETS } from "@/content/hair-presets";
import { SKIN_STEPS } from "@/content/skin-steps";
import type { Preset } from "@/content/types";
import type { FaceShape } from "@/lib/face/types";
import type { Questionnaire } from "@/lib/questionnaire";
import { exerciseEligible, hairAdviceAllowed } from "./eligibility";
import type { BodyRules } from "./bodyRules";

export type CatalogFilter = {
  faceShape: FaceShape;
  questionnaire: Questionnaire;
  body: BodyRules;
};

export type AllowedCatalog = {
  hair: Preset[];
  beard: Preset[];
  color: Preset[];
  exercises: typeof EXERCISES;
  skinSteps: typeof SKIN_STEPS;
  habits: typeof HABITS;
};

export function presentationMatches(p: Preset, presentation: Questionnaire["presentation"]): boolean {
  if (!p.presentation) return true;
  if (presentation === "unspecified") return true;
  return p.presentation.includes(presentation);
}

export function allowedCatalog(f: CatalogFilter): AllowedCatalog {
  const q = f.questionnaire;
  const shapeOrAll = (list: Preset[]) => {
    const fit = list.filter((p) => p.suits.includes(f.faceShape));
    return fit.length >= 3 ? fit : list;
  };
  const hair = hairAdviceAllowed(q)
    ? shapeOrAll(HAIR_PRESETS.filter((p) => presentationMatches(p, q.presentation) && (!p.hairTypes || p.hairTypes.includes(q.hairType))))
    : [];
  const beard = q.presentation === "female" || q.beardPreference === "none" ? [] : shapeOrAll(BEARD_PRESETS);
  const color = hairAdviceAllowed(q) ? COLOR_PRESETS : [];
  const budgetRank = { low: 0, medium: 1, high: 2 } as const;
  const skinSteps = SKIN_STEPS.filter((s) => budgetRank[s.budget] <= budgetRank[q.budget] && (s.skinTypes.length === 0 || s.skinTypes.includes(q.skinType)));
  const habits = HABITS.filter((h) => !h.weightRelated || f.body.mode === "deficit" || f.body.mode === "debloat" || h.id === "hb_strength");
  return {
    hair,
    beard,
    color,
    exercises: exerciseEligible(q) ? EXERCISES : [],
    skinSteps,
    habits: f.body.mode === "none" ? HABITS.filter((h) => !h.weightRelated) : habits,
  };
}

/** Prompt için kısa liste: id + Türkçe ad + not. */
export function catalogForPrompt(c: AllowedCatalog) {
  const p = (list: Preset[]) => list.map((x) => ({ id: x.id, name: x.nameTr, note: x.noteTr ?? "" }));
  return {
    hairPresets: p(c.hair),
    beardPresets: p(c.beard),
    colorPresets: p(c.color),
    exercises: c.exercises.map((e) => ({ id: e.id, name: e.nameTr, dose: e.doseTr })),
    skinSteps: c.skinSteps.map((s) => ({ id: s.id, name: s.nameTr, slot: s.slot, note: s.noteTr })),
    habits: c.habits.map((h) => ({ id: h.id, name: h.nameTr, defaultTarget: h.defaultTargetTr })),
  };
}
