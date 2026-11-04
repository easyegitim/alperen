import { describe, expect, it } from "vitest";
import { CALIBRATION_H2_DEFAULT, getCalibrationH2 } from "@/lib/config/engine.h2.server";
import { RANGE_HALF_WIDTH, RUBRIC_REFERENCE, calibrateH2, calibrationSlope, normalCdf, percentileH2, rangeAround, zFromRaw } from "@/lib/score/engine/calibrationH2";

// Kalibrasyon h2 (KB §4.4; CONTRACTS_V2 §4): herkese aynı; merkez/SS env'den; yüzdelik normal CDF; aralık ±0,2.

describe("calibrateH2", () => {
  it("tipik cetvel puanı (çapa 3 = 5,5) varsayılan ayarla 5,5'e eşlenir; ödeme girdisi yoktur", () => {
    expect(calibrateH2(5.5)).toBe(5.5);
    expect(calibrateH2(5.5, getCalibrationH2({}))).toBe(5.5);
    expect(getCalibrationH2({})).toEqual(CALIBRATION_H2_DEFAULT);
  });
  it("varsayılan merkez 5,5 / SS 1,5 ile kimlik (yalnız yuvarlama ve kenetleme)", () => {
    for (const raw of [2, 3.8, 5.5, 7.3, 9]) expect(calibrateH2(raw)).toBe(raw);
    expect(calibrateH2(0.5)).toBe(1.0);
    expect(calibrateH2(10)).toBe(9.8);
  });
  it("ham puanda monoton artan", () => {
    let prev = -Infinity;
    for (let raw = 1; raw <= 10; raw += 0.1) {
      const v = calibrateH2(raw);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
  it("merkez ve SS env'den: CALIBRATION_H2_CENTER=6 ile tipik 6,0; SS 1,2 ile çapa 5 ≈ 8,8", () => {
    const cal = getCalibrationH2({ CALIBRATION_H2_CENTER: "6", CALIBRATION_H2_SD: "1.2" });
    expect(calibrateH2(5.5, cal)).toBe(6.0);
    expect(calibrateH2(9, cal)).toBe(8.8); // 6 + (3,5/1,5)·1,2
    expect(calibrateH2(2, cal)).toBe(3.2);
    // Geçersiz değer varsayılana düşer.
    expect(calibrateH2(5.5, getCalibrationH2({ CALIBRATION_H2_CENTER: "12", CALIBRATION_H2_SD: "0" }))).toBe(5.5);
  });
  it("z ve eğim", () => {
    expect(zFromRaw(5.5)).toBe(0);
    expect(zFromRaw(7)).toBeCloseTo(1, 10);
    expect(calibrationSlope()).toBe(1);
    expect(calibrationSlope({ center: 5.5, sd: 3, min: 1, max: 9.8 })).toBeCloseTo(2, 10);
    expect(RUBRIC_REFERENCE).toEqual({ mean: 5.5, sd: 1.5 });
  });
});

describe("percentileH2 / normalCdf", () => {
  it("Φ(0)=0,5; simetrik; bilinen değerler", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1)).toBeCloseTo(0.8413, 3);
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(1) + normalCdf(-1)).toBeCloseTo(1, 6);
  });
  it("tipik → 50; 7,0 (z=1) → 84,1; monoton; 0–100 arası tek ondalık", () => {
    expect(percentileH2(5.5)).toBe(50);
    expect(percentileH2(7)).toBe(84.1);
    expect(percentileH2(4)).toBe(15.9);
    expect(percentileH2(10)).toBeLessThanOrEqual(100);
    expect(percentileH2(1)).toBeGreaterThanOrEqual(0);
    expect(percentileH2(6)).toBeGreaterThan(percentileH2(5.9));
  });
});

describe("rangeAround", () => {
  it("KB örneği: 6,4 → 6,2–6,6; değer aralığın içinde; uçlarda kenetli", () => {
    expect(RANGE_HALF_WIDTH).toBe(0.2);
    expect(rangeAround(6.4)).toEqual([6.2, 6.6]);
    expect(rangeAround(9.8)).toEqual([9.6, 9.8]);
    expect(rangeAround(1.0)).toEqual([1.0, 1.2]);
    const [lo, hi] = rangeAround(5.5);
    expect(lo).toBeLessThanOrEqual(5.5);
    expect(hi).toBeGreaterThanOrEqual(5.5);
  });
});
