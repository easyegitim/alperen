import { describe, expect, it } from "vitest";
import { WEIGHTS_H1 } from "@/lib/config/engine.server";
import {
  BLEND_CLAUDE_WEIGHT,
  CALIBRATION_H2_DEFAULT,
  CONSENSUS,
  ENGINE_H2,
  NOISE_BAND,
  POTENTIAL_H2,
  SET_CACHE_DAYS,
  STRUCTURAL_SUBS_H2,
  SUB_WEIGHTS_H2,
  getCalibrationH2,
  getStructuralSource,
} from "@/lib/config/engine.h2.server";
import { SUB_KEYS_V1, SUB_KEYS_V2 } from "@/lib/config/teaser";

describe("engine.h2.server (CONTRACTS_V2 §4)", () => {
  it("sürüm etiketleri ve sabitler KB'ye uyar", () => {
    expect(ENGINE_H2).toEqual({ version: "hybrid.v2", promptVersion: "score.v2", calibrationVersion: "h2" });
    expect(CALIBRATION_H2_DEFAULT).toMatchObject({ center: 5.5, sd: 1.5 });
    expect(CONSENSUS).toEqual({ runs: 3, extraRunIfSpread: 0.5, maxRuns: 4 });
    expect(POTENTIAL_H2).toEqual({ maxAboveOverall: 1.5, absoluteMax: 9.5 });
    expect(NOISE_BAND).toBe(0.3);
    expect(SET_CACHE_DAYS).toBe(365);
    expect(BLEND_CLAUDE_WEIGHT).toBe(0.5);
    expect(STRUCTURAL_SUBS_H2).toEqual(["harmony", "eyes", "jawline"]);
  });

  it("h2 ağırlıkları: 7 anahtar, toplam 1, kaş 0,06/1,06, oranlar h1 ile aynı", () => {
    expect(Object.keys(SUB_WEIGHTS_H2).sort()).toEqual([...SUB_KEYS_V2].sort());
    expect(SUB_KEYS_V2.reduce((s, k) => s + SUB_WEIGHTS_H2[k], 0)).toBeCloseTo(1, 12);
    expect(SUB_WEIGHTS_H2.brows).toBeCloseTo(0.06 / 1.06, 12);
    for (const k of SUB_KEYS_V1) expect(SUB_WEIGHTS_H2[k]).toBeCloseTo(WEIGHTS_H1[k] / 1.06, 12);
    expect(SUB_WEIGHTS_H2.skin / SUB_WEIGHTS_H2.eyes).toBeCloseTo(WEIGHTS_H1.skin / WEIGHTS_H1.eyes, 12);
  });

  it("STRUCTURAL_SOURCE: varsayılan blend; geçersizde blend; claude/geometry okunur", () => {
    expect(getStructuralSource({})).toBe("blend");
    expect(getStructuralSource({ STRUCTURAL_SOURCE: "nope" })).toBe("blend");
    expect(getStructuralSource({ STRUCTURAL_SOURCE: "claude" })).toBe("claude");
    expect(getStructuralSource({ STRUCTURAL_SOURCE: " geometry " })).toBe("geometry");
  });

  it("CALIBRATION_H2 env'den okunur, aralık dışı ve boş değer varsayılana düşer", () => {
    expect(getCalibrationH2({})).toEqual({ center: 5.5, sd: 1.5, min: 1.0, max: 9.8 });
    expect(getCalibrationH2({ CALIBRATION_H2_CENTER: "5.8", CALIBRATION_H2_SD: "1.2" })).toMatchObject({ center: 5.8, sd: 1.2 });
    expect(getCalibrationH2({ CALIBRATION_H2_CENTER: "12", CALIBRATION_H2_SD: "0" })).toMatchObject({ center: 5.5, sd: 1.5 });
    expect(getCalibrationH2({ CALIBRATION_H2_CENTER: "", CALIBRATION_H2_SD: "abc" })).toMatchObject({ center: 5.5, sd: 1.5 });
  });
});
