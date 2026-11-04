import { describe, expect, it } from "vitest";
import { POTENTIAL_H2, SUB_WEIGHTS_H2 } from "@/lib/config/engine.h2.server";
import { SUB_KEYS_V2, type SubKey } from "@/lib/config/teaser";
import { ExplanationV2 } from "@/lib/score/contract";
import { calibrateH2 } from "@/lib/score/engine/calibrationH2";
import { SUB_GAIN_CAP_H2, buildExplanation, computePotentialH2, improveFirstV2, subGains, validRaise, weightedOverall, weightsH2 } from "@/lib/score/engine/explain";
import { PLAN_STEPS_V2, isStepAllowed, planStepsForPrompt, stepsForSub } from "@/lib/score/engine/planSteps";
import { assessment, scoreOutput } from "../helpers/engineV2Fixtures";

// KB §4.9 beş satır, K2 potansiyel (+1,5 / 9,5, plan adımına bağlı), P#13 önce odaklan (≤3), Ç2 katalog.

describe("planSteps", () => {
  it("katalog yalnız content/ kimliklerinden; brows için lv_brow_tidy; yapısal alanlar yalnız stil/algı adımı", () => {
    expect(PLAN_STEPS_V2.every((s) => /^(st_|hb_|lv_)|^[a-z_]+$/.test(s.id))).toBe(true);
    expect(isStepAllowed("skin", "st_spf")).toBe(true);
    expect(isStepAllowed("hair", "st_spf")).toBe(false);
    expect(isStepAllowed("brows", "lv_brow_tidy")).toBe(true);
    expect(isStepAllowed("harmony", "textured_crop")).toBe(true);
    expect(isStepAllowed("harmony", "st_spf")).toBe(false);
    expect(isStepAllowed("skin", "uydurma_adim")).toBe(false);
    expect(stepsForSub("grooming").some((s) => s.id === "st_lip_balm")).toBe(true);
    const p = planStepsForPrompt({ hairAllowed: false, beardAllowed: false });
    expect(p.hair).toEqual([]);
    expect(p.grooming.some((l) => l.startsWith("stubble_light"))).toBe(false);
    expect(planStepsForPrompt({ hairAllowed: true, beardAllowed: true }).hair.length).toBeGreaterThan(0);
  });
});

describe("buildExplanation", () => {
  it("beş satır sözleşmeye uyar; bilinmeyen adım düşer; adım metni katalogdan; güven notu açı ve ışık söyler", () => {
    const a = assessment(6.2, { raise: [{ stepId: "st_spf", effect: "Ton eşitliği artar.", gain: 0.5 }, { stepId: "uydurma", effect: "x", gain: 1 }] });
    const e = buildExplanation("skin", a, { viewsUsed: 3, lighting: "even" });
    expect(ExplanationV2.safeParse(e).success).toBe(true);
    expect(e.raise).toEqual([{ step: "Güneş koruyucu SPF 30+", effect: "Ton eşitliği artar." }]);
    expect(e.confidenceNote).toBe("Üç açı kullanıldı; ışık dengeli; güven yüksek.");
    expect(e.lookedAt).toEqual(["Alın ve yanak dokusu", "T bölgesi parlaması"]);
  });
  it("boş satırlar şablonla dolar; yapısal alanda raise boşsa algı notu; uzun metin kesilir", () => {
    const a = assessment(5.5, { lookedAt: [], held: ["  "], lowered: ["x".repeat(400)], raise: [] }, "harmony");
    const e = buildExplanation("harmony", a, { viewsUsed: 1, lighting: "harsh_or_dim" });
    expect(e.lookedAt[0]).toContain("yüz uyumu");
    expect(e.held[0]).toContain("Yüz uyumu");
    expect(e.lowered[0].length).toBeLessThanOrEqual(200);
    expect(e.raise[0].step).toContain("bakımla değişmez");
    expect(e.confidenceNote).toContain("Tek açı");
    expect(ExplanationV2.safeParse(e).success).toBe(true);
  });
  it("validRaise: yapısal alt skorda kazanç 0; tekrar eden adım bir kez; en çok 3", () => {
    const r = validRaise("jawline", assessment(5.5, { raise: [{ stepId: "stubble_light", effect: "a", gain: 1.2 }, { stepId: "stubble_light", effect: "b", gain: 1 }] }));
    expect(r).toHaveLength(1);
    expect(r[0].gain).toBe(0);
    const many = validRaise("skin", assessment(5.5, { raise: ["st_spf", "st_cleanser_gentle", "st_moisturizer_light", "st_exfoliant_weekly"].map((id) => ({ stepId: id, effect: "e", gain: 0.4 })) }));
    expect(many).toHaveLength(3);
  });
  it("uygunluk filtresi: saç yasakken saç preset'i ve saç adımı düşer; sakal yasakken sakal preset'i düşer (istemle aynı kural)", () => {
    const hairRaise = assessment(5.5, { raise: [{ stepId: "textured_crop", effect: "a", gain: 0 }, { stepId: "lv_brow_tidy", effect: "b", gain: 0 }] }, "harmony");
    expect(validRaise("harmony", hairRaise).map((r) => r.stepId)).toEqual(["textured_crop", "lv_brow_tidy"]);
    expect(validRaise("harmony", hairRaise, { hairAllowed: false, beardAllowed: true }).map((r) => r.stepId)).toEqual(["lv_brow_tidy"]);
    const beardRaise = assessment(5.5, { raise: [{ stepId: "stubble_light", effect: "a", gain: 0 }, { stepId: "lv_beard_lineup", effect: "b", gain: 0 }] }, "jawline");
    expect(validRaise("jawline", beardRaise, { hairAllowed: true, beardAllowed: false }).map((r) => r.stepId)).toEqual(["lv_beard_lineup"]);
    const hairStep = assessment(5.5, { raise: [{ stepId: "st_hair_conditioner", effect: "a", gain: 0.4 }] }, "hair");
    expect(validRaise("hair", hairStep, { hairAllowed: false, beardAllowed: true })).toEqual([]);
    expect(buildExplanation("harmony", hairRaise, { viewsUsed: 2, lighting: "even", eligibility: { hairAllowed: false, beardAllowed: true } }).raise.map((r) => r.step)).not.toContain(expect.stringMatching(/kesim/i));
    const out = scoreOutput();
    expect(improveFirstV2(out, weightsH2({ hairExcluded: true }), new Set(["hair"]), 1, { hairAllowed: false, beardAllowed: false }).some((i) => /sakal|kesim/i.test(i.step))).toBe(false);
    expect(subGains(out, new Set(), { hairAllowed: false, beardAllowed: true }).hair).toBe(0);
  });
});

describe("kazanç, ağırlık ve potansiyel", () => {
  it("ağırlıklar 1'e toplanır; saç hariç → saç 0, kalanı orantılı", () => {
    const w = weightsH2({ hairExcluded: false });
    expect(SUB_KEYS_V2.reduce((s, k) => s + w[k], 0)).toBeCloseTo(1, 10);
    expect(w.brows).toBeCloseTo(0.0566, 3);
    const wx = weightsH2({ hairExcluded: true });
    expect(wx.hair).toBe(0);
    expect(SUB_KEYS_V2.reduce((s, k) => s + wx[k], 0)).toBeCloseTo(1, 10);
    expect(wx.skin / wx.harmony).toBeCloseTo(SUB_WEIGHTS_H2.skin / SUB_WEIGHTS_H2.harmony, 10);
  });
  it("subGains: yalnız kataloğa bağlı adımlar, tavan 2,0, yapısal ve hariç alt skorlarda 0", () => {
    const g = subGains(scoreOutput(), new Set());
    expect(g.skin).toBe(0.8);
    expect(g.hair).toBe(0.4);
    expect(g.harmony).toBe(0);
    expect(subGains(scoreOutput(), new Set<SubKey>(["hair"])).hair).toBe(0);
    const big = scoreOutput();
    big.subscores.skin = assessment(5.5, { raise: [{ stepId: "st_spf", effect: "e", gain: 1.5 }, { stepId: "st_cleanser_gentle", effect: "e", gain: 1.5 }] });
    expect(subGains(big, new Set()).skin).toBe(SUB_GAIN_CAP_H2);
  });
  it("çalışılmış örnek: tipik profil (her alt skor 5,5) → genel 5,5; potansiyel = 5,5 + ağırlıklı kazanç ≈ 5,8", () => {
    const raw = Object.fromEntries(SUB_KEYS_V2.map((k) => [k, 5.5])) as Record<SubKey, number>;
    const w = weightsH2({ hairExcluded: false });
    expect(calibrateH2(weightedOverall(raw, w))).toBe(5.5);
    const gains = subGains(scoreOutput(), new Set());
    const { potential, potentialRaw } = computePotentialH2({ raw, gains, weights: w, overall: 5.5, calibrate: (r) => calibrateH2(r) });
    // 0,1887·0,8 + 0,1887·0,4 + 0,1887·0,3 + 0,0566·0,3 ≈ 0,30
    expect(potentialRaw).toBeCloseTo(5.8, 1);
    expect(potential).toBe(5.8);
  });
  it("potansiyel tavanları: en fazla +1,5, en çok 9,5; genelden küçük olamaz", () => {
    const raw = Object.fromEntries(SUB_KEYS_V2.map((k) => [k, 5.5])) as Record<SubKey, number>;
    const w = weightsH2({ hairExcluded: false });
    const huge = Object.fromEntries(SUB_KEYS_V2.map((k) => [k, 2])) as Record<SubKey, number>;
    expect(computePotentialH2({ raw, gains: huge, weights: w, overall: 5.5, calibrate: (r) => calibrateH2(r) }).potential).toBe(5.5 + POTENTIAL_H2.maxAboveOverall);
    const top = Object.fromEntries(SUB_KEYS_V2.map((k) => [k, 9])) as Record<SubKey, number>;
    expect(computePotentialH2({ raw: top, gains: huge, weights: w, overall: 9, calibrate: (r) => calibrateH2(r) }).potential).toBe(POTENTIAL_H2.absoluteMax);
    expect(computePotentialH2({ raw, gains: Object.fromEntries(SUB_KEYS_V2.map((k) => [k, 0])) as Record<SubKey, number>, weights: w, overall: 5.5, calibrate: (r) => calibrateH2(r) }).potential).toBe(5.5);
  });
  it("improveFirst: en çok 3, her alt skorun en iyisi önce, kazanç genel skor puanı, yapısal yok", () => {
    const items = improveFirstV2(scoreOutput(), weightsH2({ hairExcluded: false }), new Set(), 1);
    expect(items.length).toBeLessThanOrEqual(3);
    expect(items[0]).toEqual({ sub: "skin", stepId: "st_spf", step: "Güneş koruyucu SPF 30+", gain: 0.1 });
    expect(items.map((i) => i.sub)).toEqual(["skin", "hair", "grooming"]);
    expect(items.every((i) => i.gain > 0 && i.gain <= 1.5)).toBe(true);
    expect(improveFirstV2(scoreOutput(), weightsH2({ hairExcluded: true }), new Set<SubKey>(["hair"]), 1).some((i) => i.sub === "hair")).toBe(false);
  });
});
