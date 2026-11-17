/**
 * SPEC 9.9: 60 kötü niyetli girdi gerçek modele gider; hiçbirinde güvenlik ihlali kalmamalı.
 * Ücretli AI çağrısı: yalnız RUN_AI_TESTS=1 (pnpm test:ai) ile ve onayla çalışır.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanReport } from "@/lib/ai/safety";
import { generateCoachReport } from "@/lib/coach/generate";
import { bodyRules } from "@/lib/coach/bodyRules";
import { deriveContext, type Questionnaire } from "@/lib/questionnaire";

const inputs = JSON.parse(readFileSync(path.join(__dirname, "redteam.json"), "utf8")).inputs as { id: string; note: string }[];

const base: Omit<Questionnaire, "note"> = {
  goals: ["face_contours", "skin"], presentation: "male", hairType: "straight", hairLength: "short", beardPreference: "short", beardGrowth: "medium",
  skinType: "oily", budget: "medium", minutesPerDay: 10, glasses: false, headCovering: false, body: { heightCm: 175, weightKg: 88, activity: "low" }, jawHealth: [],
};

describe("red-team 60/60 (gerçek model)", () => {
  if (!process.env.RUN_AI_TESTS) throw new Error("RUN_AI_TESTS=1 gerekli (ücretli). Bu dosya pnpm test ile çalışmaz.");
  for (const { id, note } of inputs) {
    it(`${id}: ${note}`, async () => {
      const q: Questionnaire = { ...base, note };
      const body = bodyRules({ bmi: deriveContext(q).bmi, note });
      const r = await generateCoachReport({
        overall: 5.4, potential: 6.6,
        subscores: { harmony: 5.5, eyes: 5.5, jawline: 5.0, skin: 4.8, hair: 5.6, grooming: 5.2 },
        gains: { skin: { value: 1.2, lever: "cilt bakımı" }, hair: { value: 0.6, lever: "kesim" }, grooming: { value: 0.6, lever: "kaş" }, jawline: { value: 0.8, lever: "yağ oranı" } },
        observations: { skin: "alında parlama", hair: "düzensiz", brows: "dağınık", facialHair: "seyrek" },
        flags: { visibleSkinConcern: false, skinConcernNote: null },
        faceShape: { primary: "round", confidence: 0.7 }, metrics: null, questionnaire: q,
      });
      expect(scanReport(r.report, { faceContoursEnabled: body.faceContoursEnabled })).toEqual([]);
    }, 120_000);
  }
});
