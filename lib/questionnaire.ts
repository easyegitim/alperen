import { z } from "zod";

// SPEC 9.2 anket şeması. Arayüz metinleri messages/tr.json "questionnaire" altında.
export const GOALS = ["hair", "beard", "skin", "face_contours", "style", "general"] as const;
export const PRESENTATIONS = ["male", "female", "unspecified"] as const;
export const HAIR_TYPES = ["straight", "wavy", "curly", "coily"] as const;
export const HAIR_LENGTHS = ["short", "medium", "long"] as const;
export const BEARD_PREFERENCES = ["none", "stubble", "short", "medium", "long", "any"] as const;
export const BEARD_GROWTHS = ["sparse", "medium", "full"] as const;
export const SKIN_TYPES = ["oily", "dry", "combination", "normal", "sensitive", "unknown"] as const;
export const BUDGETS = ["low", "medium", "high"] as const;
export const MINUTES_PER_DAY = [5, 10, 20] as const;
export const ACTIVITIES = ["low", "medium", "high"] as const;
export const JAW_HEALTH_ISSUES = ["jaw_pain", "clicking", "bruxism", "orthodontic"] as const;

export const BodySchema = z.object({
  heightCm: z.number().int().min(100).max(250),
  weightKg: z.number().min(30).max(300),
  activity: z.enum(ACTIVITIES),
});

export const QuestionnaireSchema = z.object({
  goals: z.array(z.enum(GOALS)).min(1).max(GOALS.length),
  presentation: z.enum(PRESENTATIONS),
  hairType: z.enum(HAIR_TYPES),
  hairLength: z.enum(HAIR_LENGTHS),
  beardPreference: z.enum(BEARD_PREFERENCES),
  beardGrowth: z.enum(BEARD_GROWTHS),
  skinType: z.enum(SKIN_TYPES),
  budget: z.enum(BUDGETS),
  minutesPerDay: z.union([z.literal(5), z.literal(10), z.literal(20)]),
  glasses: z.boolean(),
  headCovering: z.boolean(),
  body: BodySchema.optional(),
  /** Boş dizi = "hiçbiri". */
  jawHealth: z.array(z.enum(JAW_HEALTH_ISSUES)).max(JAW_HEALTH_ISSUES.length),
  note: z.string().trim().max(300).optional(),
});

export type Questionnaire = z.infer<typeof QuestionnaireSchema>;
export type Body = z.infer<typeof BodySchema>;

/** SPEC 9.2 sunucu bağlamı: VKİ, yağ oranı önerisi izni, egzersiz uygunluğu. */
export function deriveContext(q: Pick<Questionnaire, "body" | "jawHealth">, bmiThreshold = 25) {
  const bmi = q.body ? round1(q.body.weightKg / (q.body.heightCm / 100) ** 2) : null;
  return {
    bmi,
    bodyFatContextAllowed: bmi !== null && bmi >= bmiThreshold,
    exerciseEligible: q.jawHealth.length === 0,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
