import { describe, expect, it } from "vitest";
import { WEIGHTS_H1, WEIGHTS_H1_HAIR_EXCLUDED } from "@/lib/config/engine.server";
import { CALIBRATION_REFERENCE } from "@/lib/config/scoring";
import { SUB_KEYS } from "@/lib/config/teaser";
import { calibrate, calibrateH1 } from "@/lib/score/calibration";
import { scoreFromVotes, scoreHybrid } from "@/lib/score/engine";
import { scoreModifiable } from "@/lib/score/engine/categories";
import { scoreStructural } from "@/lib/score/engine/geometry";
import { BEST_OBS, CTX, GEO, REF_OBS, UNTENDED_OBS, geo, obs } from "../helpers/engineFixtures";

describe("genel skor ve kalibrasyon h1 (engine spec §5)", () => {
  it("iki ağırlık seti 1'e toplanır", () => {
    for (const w of [WEIGHTS_H1, WEIGHTS_H1_HAIR_EXCLUDED]) expect(SUB_KEYS.reduce((s, k) => s + w[k], 0)).toBeCloseTo(1, 12);
  });

  it("calibrate(x, 'h1') kimlik + kenetleme; aynı girdi aynı çıktı", () => {
    expect(calibrate(6.5, "h1")).toBe(6.5);
    expect(calibrate(5.46, "h1")).toBe(5.5);
    expect(calibrate(0.2, "h1")).toBe(1);
    expect(calibrate(12, "h1")).toBe(9.8);
    expect(calibrateH1(4.444)).toBe(4.444);
    expect(calibrate(6.31, "h1")).toBe(calibrate(6.31, "h1"));
  });

  it("referans profil tam 5,5 (saç hariç de); genel = atanan alt skorların ağırlıklı ortalaması (±0,05)", () => {
    const ref = scoreFromVotes(GEO, CTX, REF_OBS);
    expect(ref.overall).toBe(CALIBRATION_REFERENCE);
    for (const k of SUB_KEYS) expect(ref.subscores[k]).toBe(CALIBRATION_REFERENCE);
    expect(scoreFromVotes(GEO, { ...CTX, headCovering: true }, REF_OBS).overall).toBe(CALIBRATION_REFERENCE);
    for (const o of [BEST_OBS, UNTENDED_OBS, obs({ skin: { blemishes: "several" } })]) {
      for (const headCovering of [false, true]) {
        const r = scoreFromVotes(geo({ metrics: { jawRatio: 1.1 } }), { ...CTX, headCovering }, o);
        const w = headCovering ? WEIGHTS_H1_HAIR_EXCLUDED : WEIGHTS_H1;
        const mean = SUB_KEYS.reduce((s, k) => s + w[k] * r.subscores[k], 0);
        expect(Math.abs(r.overall - mean)).toBeLessThanOrEqual(0.05 + 1e-9);
      }
    }
  });

  it("§5.2 dağılım tablosu", () => {
    expect(scoreFromVotes(GEO, CTX, BEST_OBS).rawOverall).toBeCloseTo(6.58, 9);
    expect(scoreFromVotes(GEO, { ...CTX, headCovering: true }, BEST_OBS).rawOverall).toBeCloseTo(6.52, 9);
    expect(scoreFromVotes(GEO, CTX, UNTENDED_OBS).rawOverall).toBeCloseTo(4.16, 9);
    const makeup = obs({ photo: { skinVisibility: "obscured" }, grooming: { lips: "smooth" } });
    expect(scoreFromVotes(GEO, { ...CTX, headCovering: true }, makeup).rawOverall).toBeCloseTo(5.74, 9);
    expect(scoreFromVotes(GEO, CTX, makeup).rawOverall).toBeCloseTo(5.66, 9);
    const outlier = geo({
      metrics: { jawRatio: 2, ipdRatio: 0.8, lowerToMiddle: 3, eyeMouthRatio: 0.7, canthalTiltDeg: 40, symmetry: { face: 0.3, eyes: 0.3, lower: 0.3 } },
    });
    expect(scoreFromVotes(outlier, CTX, REF_OBS).rawOverall).toBeCloseTo(4.7, 9);
    expect(scoreFromVotes(outlier, CTX, UNTENDED_OBS).rawOverall).toBeCloseTo(3.36, 9);
  });

  it("hiçbir imzada premium/plan parametresi yok", () => {
    expect(calibrate.length).toBe(2);
    expect(calibrateH1.length).toBe(1);
    expect(scoreStructural.length).toBe(2);
    expect(scoreModifiable.length).toBe(2);
    expect(scoreFromVotes.length).toBe(3);
    // scoreHybrid: görsel, geometri, bağlam (+ sağlayıcı, seçenekler); seçeneklerde ödeme alanı yok.
    expect(scoreHybrid.length).toBeLessThanOrEqual(3);
    for (const k of Object.keys(CTX)) expect(k).not.toMatch(/premium|plan|paid|subscription/i);
  });
});
