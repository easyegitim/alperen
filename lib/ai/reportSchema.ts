import { z } from "zod";

// SPEC 9.7 rapor şeması (birebir).
const Pick = z.object({
  presetId: z.string(),
  why: z.string().max(240),
  barberScript: z.string().max(240),
  maintenance: z.string().max(160),
});
const Step = z.object({ stepType: z.string(), note: z.string().max(140) }); // stepType: content/skin-steps id

export const CoachReport = z.object({
  summary: z.string().max(450),
  scoreNarrative: z.string().max(400), // skor ve potansiyelin nötr açıklaması
  hair: z.array(Pick).max(3),
  beard: z.array(Pick).max(3),
  hairColor: Pick.nullable(),
  skincare: z.object({
    morning: z.array(Step).max(5),
    evening: z.array(Step).max(5),
    weekly: z.array(Step).max(3),
  }),
  faceContours: z.object({
    // 9.4 kurallarına bağlı
    enabled: z.boolean(),
    tips: z.array(z.string().max(160)).max(5),
  }),
  exercises: z.array(z.object({ id: z.string(), why: z.string().max(160) })).max(4),
  habits: z.array(z.object({ id: z.string(), target: z.string().max(80) })).max(5),
  style: z.array(z.string().max(160)).max(4),
  linkedActions: z.object({
    // potansiyel kazançların plan eylemleri
    skin: z.array(z.string()),
    hair: z.array(z.string()),
    grooming: z.array(z.string()),
    jawline: z.array(z.string()),
  }),
  seeProfessional: z.object({ specialty: z.string(), text: z.string().max(220) }).nullable(),
});

export type CoachReport = z.infer<typeof CoachReport>;
export type ReportPick = z.infer<typeof Pick>;
export const COACH_REPORT_JSON_SCHEMA = z.toJSONSchema(CoachReport);
