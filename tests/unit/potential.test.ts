import { describe, expect, it } from "vitest";
import { calibrate } from "@/lib/score/calibration";
import { computePotential, computePotentialRaw, effectiveGain, jawlineCap, type PotentialInput } from "@/lib/score/potential";

const base: PotentialInput = {
  rawSubscores: { harmony: 6, eyes: 6, jawline: 6, skin: 6, hair: 6, grooming: 6 },
  gains: { skin: { value: 1.2, lever: "" }, hair: { value: 2.0, lever: "" }, grooming: { value: 0.8, lever: "" }, jawline: { value: 1.0, lever: "" } },
  overall: 5.5,
  bodyFatContextAllowed: false,
  beardOption: false,
  calibrate: (raw) => calibrate(raw, "v0"),
};

describe("potansiyel (SPEC 8.5)", () => {
  it("harmony ve eyes kazancı 0; tavanlar uygulanır", () => {
    expect(effectiveGain("harmony", base)).toBe(0);
    expect(effectiveGain("eyes", base)).toBe(0);
    expect(effectiveGain("hair", base)).toBe(1.5); // 2.0 → tavan 1.5
    expect(effectiveGain("skin", base)).toBe(1.2);
  });
  it("çene hattı: yağ oranı bağlamı veya sakal yoksa en çok 0,3; varsa 1,0", () => {
    expect(jawlineCap(false, false)).toBe(0.3);
    expect(jawlineCap(true, false)).toBe(1);
    expect(jawlineCap(false, true)).toBe(1);
    expect(effectiveGain("jawline", base)).toBe(0.3);
    expect(effectiveGain("jawline", { ...base, beardOption: true })).toBe(1);
  });
  it("plana bağlanmayan kazanç 0 sayılır", () => {
    expect(effectiveGain("skin", { ...base, linkedActions: { skin: [] } })).toBe(0);
    expect(effectiveGain("skin", { ...base, linkedActions: { skin: ["step_moisturizer"] } })).toBe(1.2);
  });
  it("ham potansiyel ağırlıklı toplam ve 10 tavanı", () => {
    const raw = computePotentialRaw(base);
    const expected = 0.25 * 6 + 0.15 * 6 + 0.15 * 6.3 + 0.15 * 7.2 + 0.15 * 7.5 + 0.15 * 6.8;
    expect(raw).toBeCloseTo(expected, 6);
    const high = computePotentialRaw({ ...base, rawSubscores: { harmony: 10, eyes: 10, jawline: 10, skin: 9.5, hair: 9.5, grooming: 9.5 } });
    expect(high).toBeLessThanOrEqual(10);
  });
  it("overall + 1,5 ve 9,5 üst sınırları; hiçbir zaman overall'ın altında değil", () => {
    expect(computePotential(base)).toBeLessThanOrEqual(5.5 + 1.5);
    expect(computePotential({ ...base, overall: 9.3, rawSubscores: { harmony: 9, eyes: 9, jawline: 9, skin: 9, hair: 9, grooming: 9 } })).toBe(9.5);
    expect(computePotential({ ...base, overall: 8, gains: { skin: { value: 0, lever: "" }, hair: { value: 0, lever: "" }, grooming: { value: 0, lever: "" }, jawline: { value: 0, lever: "" } } })).toBe(8);
  });
});

describe("potansiyel h1 geçersiz kılmaları (engine spec §6.2)", () => {
  const h1Gains = { skin: { value: 2.6, lever: "" }, hair: { value: 2, lever: "" }, grooming: { value: 0.8, lever: "" }, jawline: { value: 0, lever: "" } };
  const W_H1 = { harmony: 0.15, eyes: 0.1, jawline: 0.15, skin: 0.2, hair: 0.2, grooming: 0.2 };
  const h1: PotentialInput = {
    ...base,
    rawSubscores: { harmony: 5.5, eyes: 5.5, jawline: 5.5, skin: 5.5, hair: 5.5, grooming: 5.5 },
    gains: h1Gains,
    overall: 5.5,
    weights: W_H1,
    caps: { skin: 2, hair: 2, grooming: 2 },
    calibrate: (raw) => calibrate(raw, "h1"),
  };
  it("geçersiz kılma yokken eski davranış aynı", () => {
    expect(computePotentialRaw(base)).toBeCloseTo(0.25 * 6 + 0.15 * 6 + 0.15 * 6.3 + 0.15 * 7.2 + 0.15 * 7.5 + 0.15 * 6.8, 9);
  });
  it("satır ağırlıkları ve 2,0 tavanları; çene kazancı 0 iken jawlineCap etkisiz", () => {
    expect(effectiveGain("skin", h1)).toBe(2);
    expect(effectiveGain("jawline", { ...h1, beardOption: true })).toBe(0);
    expect(computePotentialRaw(h1)).toBeCloseTo(5.5 + 0.2 * 2 + 0.2 * 2 + 0.2 * 0.8, 9);
    expect(computePotential(h1)).toBe(6.5);
    const excluded = { ...h1, weights: { ...W_H1, skin: 0.3, hair: 0, grooming: 0.3 } };
    expect(computePotential(excluded)).toBe(6.3);
  });
});
