// SPEC 9.2 anket sihirbazının saf durumu: adımlar, devam koşulu, taslak → şema. Web sihirbazıyla aynı kurallar; birim testli.
import { QuestionnaireSchema, type ACTIVITIES, type Questionnaire } from "@/lib/questionnaire";

export type Draft = Partial<Omit<Questionnaire, "body">> & {
  body?: { heightCm?: string; weightKg?: string; activity?: (typeof ACTIVITIES)[number] };
  bodySkipped?: boolean;
};

export const STEPS = ["goals", "presentation", "hair", "beard", "skin", "budget", "accessories", "body", "jawHealth", "note"] as const;
export type Step = (typeof STEPS)[number];
export const DRAFT_KEY = "aura.questionnaire.draft.v1";

export function toDraft(initial?: Partial<Questionnaire>): Draft {
  if (!initial) return { jawHealth: [] };
  const { body, ...rest } = initial;
  return {
    ...rest,
    jawHealth: initial.jawHealth ?? [],
    body: body ? { heightCm: String(body.heightCm), weightKg: String(body.weightKg), activity: body.activity } : undefined,
  };
}

export function canContinue(step: Step, draft: Draft): boolean {
  switch (step) {
    case "goals":
      return (draft.goals?.length ?? 0) > 0;
    case "presentation":
      return Boolean(draft.presentation);
    case "hair":
      return Boolean(draft.hairType && draft.hairLength);
    case "beard":
      return Boolean(draft.beardPreference && draft.beardGrowth);
    case "skin":
      return Boolean(draft.skinType);
    case "budget":
      return Boolean(draft.budget && draft.minutesPerDay);
    case "accessories":
      return typeof draft.glasses === "boolean" && typeof draft.headCovering === "boolean";
    case "body": {
      if (draft.bodySkipped) return true;
      const b = draft.body;
      return Boolean(b?.heightCm && b?.weightKg && b?.activity);
    }
    case "jawHealth":
      return Array.isArray(draft.jawHealth);
    case "note":
      return (draft.note?.length ?? 0) <= 300;
  }
}

/** Taslağı sunucu şemasına çevirir; geçersizse null (sunucu yine Zod ile doğrular). */
export function toPayload(draft: Draft): Questionnaire | null {
  const body =
    !draft.bodySkipped && draft.body?.heightCm && draft.body?.weightKg && draft.body?.activity
      ? { heightCm: Number(draft.body.heightCm), weightKg: Number(String(draft.body.weightKg).replace(",", ".")), activity: draft.body.activity }
      : undefined;
  const { bodySkipped: _skip, ...rest } = draft;
  void _skip;
  const parsed = QuestionnaireSchema.safeParse({ ...rest, body, note: draft.note?.trim() || undefined });
  return parsed.success ? parsed.data : null;
}

export function parseDraft(raw: string | null): Draft {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as Draft) : {};
  } catch {
    return {};
  }
}
