import { z } from "zod";

// SPEC 8.3 şeması. Gemini'ye responseJsonSchema olarak verilir, sunucuda Zod ile doğrulanır.
const Sub = z.number().min(1).max(10);
const Gain = z.object({ value: z.number().min(0).max(2), lever: z.string().max(120) });

export const ScoreOutput = z.object({
  subscores: z.object({ harmony: Sub, eyes: Sub, jawline: Sub, skin: Sub, hair: Sub, grooming: Sub }),
  achievableGain: z.object({ skin: Gain, hair: Gain, grooming: Gain, jawline: Gain }),
  observations: z.object({
    skin: z.string().max(200),
    hair: z.string().max(200),
    brows: z.string().max(120),
    facialHair: z.string().max(120),
  }),
  flags: z.object({
    visibleSkinConcern: z.boolean(), // belirgin kızarıklık, yaygın sivilce vb.
    skinConcernNote: z.string().max(160).nullable(),
    multiplePeopleOrNotAFace: z.boolean(),
  }),
});

export type ScoreOutput = z.infer<typeof ScoreOutput>;
export type GainKey = keyof ScoreOutput["achievableGain"];

export const SCORE_OUTPUT_JSON_SCHEMA = z.toJSONSchema(ScoreOutput);
