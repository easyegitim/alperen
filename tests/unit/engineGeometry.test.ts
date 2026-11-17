import { describe, expect, it } from "vitest";
import { BANDS, STRUCT, WEIGHTS_H1, type ComponentKey } from "@/lib/config/engine.server";
import { oneSided, ramp, scoreStructural, twoSided } from "@/lib/score/engine/geometry";
import { scoreFromVotes } from "@/lib/score/engine";
import { CTX, GEO, REF_OBS, geo, obs } from "../helpers/engineFixtures";

const noBeard = { beardOverJaw: false };

describe("ceza fonksiyonları (engine spec §3.4)", () => {
  it("twoSided: merkezde ve kenarda 0, rampanın ortasında 0,5, ötesinde 1", () => {
    expect(twoSided(1.11, 1.11, 0.17, 0.25)).toBe(0);
    expect(twoSided(1.28, 1.11, 0.17, 0.25)).toBeCloseTo(0, 9);
    expect(twoSided(1.405, 1.11, 0.17, 0.25)).toBeCloseTo(0.5, 9);
    expect(twoSided(2, 1.11, 0.17, 0.25)).toBe(1);
    expect(twoSided(0.94 - 0.125, 1.11, 0.17, 0.25)).toBeCloseTo(0.5, 9); // simetrik
  });
  it("oneSided: yalnız fazla asimetri", () => {
    expect(oneSided(0, 0.02, 0.04)).toBe(0);
    expect(oneSided(0.02, 0.02, 0.04)).toBe(0);
    expect(oneSided(0.04, 0.02, 0.04)).toBeCloseTo(0.5, 9);
    expect(oneSided(0.5, 0.02, 0.04)).toBe(1);
  });
  it("ramp sürekli: 8'de 1, 12'de 0", () => {
    expect(ramp(8, 8, 12)).toBe(1);
    expect(ramp(10, 8, 12)).toBeCloseTo(0.5, 9);
    expect(ramp(12, 8, 12)).toBe(0);
  });
});

describe("scoreStructural", () => {
  it("bant içi geometri her yapısal alt skorda 5,5; durumlar yalnız measured/not_measured", () => {
    const r = scoreStructural(GEO, noBeard);
    expect(r.subs).toEqual({ harmony: 5.5, eyes: 5.5, jawline: 5.5 });
    expect(new Set(r.components.map((c) => c.status))).toEqual(new Set(["measured"]));
    for (const c of scoreStructural(geo({ metrics: { jawRatio: 2, symmetry: null } }), { beardOverJaw: true }).components) {
      expect(["measured", "not_measured"]).toContain(c.status);
    }
  });

  it("tek bant herkes için: imza sunum almaz; aynı geometri her ankette aynı yapısal skor", () => {
    expect(scoreStructural.length).toBe(2);
    const g = geo({ metrics: { jawRatio: 1.02, canthalTiltDeg: -6, lowerToMiddle: 1.4 } });
    const male = scoreFromVotes(g, { ...CTX, presentation: "male" }, REF_OBS);
    const female = scoreFromVotes(g, { ...CTX, presentation: "female" }, REF_OBS);
    const unspecified = scoreFromVotes(g, { ...CTX, presentation: "unspecified", beardPreference: "none" }, REF_OBS);
    for (const k of ["harmony", "eyes", "jawline"] as const) {
      expect(female.subscores[k]).toBe(male.subscores[k]);
      expect(unspecified.subscores[k]).toBe(male.subscores[k]);
    }
  });

  it("düz sıfır-ceza bölgeleri: jaw .75–.95, L2M .94–1.28, ipd .43–.515, tilt −3…+14", () => {
    const flat = (patch: Parameters<typeof geo>[0]) => scoreStructural(geo(patch), noBeard).subs;
    for (const jawRatio of [0.75, 0.8, 0.85, 0.9, 0.95]) expect(flat({ metrics: { jawRatio } }).jawline).toBeCloseTo(5.5, 9);
    for (const lowerToMiddle of [0.94, 1.0, 1.11, 1.2, 1.28]) expect(flat({ metrics: { lowerToMiddle } }).harmony).toBeCloseTo(5.5, 9);
    for (const ipdRatio of [0.43, 0.46, 0.5, 0.515]) expect(flat({ metrics: { ipdRatio } }).eyes).toBeCloseTo(5.5, 9);
    for (const canthalTiltDeg of [-3, 0, 5.5, 10, 14]) expect(flat({ metrics: { canthalTiltDeg } }).eyes).toBeCloseTo(5.5, 9);
    // Ceza simetrik: eğim merkezden aynı uzaklıkta aynı ceza ("pozitif eğim" ödüllendirilmez).
    expect(flat({ metrics: { canthalTiltDeg: 5.5 + 11 } }).eyes).toBeCloseTo(flat({ metrics: { canthalTiltDeg: 5.5 - 11 } }).eyes, 9);
  });

  it("eksik ölçüm maliyetsiz: yeni alanlar yokken skor bant içi değerlerle aynı", () => {
    const old = geo({ metrics: { ipdRatio: undefined, eyeMouthRatio: undefined, symmetry: undefined } });
    expect(scoreStructural(old, noBeard).subs).toEqual(scoreStructural(GEO, noBeard).subs);
    const r = scoreStructural(old, noBeard);
    expect(r.components.filter((c) => c.status === "not_measured").map((c) => c.key).sort()).toEqual(
      ["eyeMouth", "spacing", "symEyes", "symFace", "symLower"].sort(),
    );
  });

  it("sakal çeneyi örterken jawWidth/symLower ölçülmez ve maliyetsizdir; bant içi sakallı = sakalsız", () => {
    expect(scoreStructural(GEO, { beardOverJaw: true }).subs.jawline).toBe(scoreStructural(GEO, noBeard).subs.jawline);
    const wide = geo({ metrics: { jawRatio: 1.2, symmetry: { face: 0.01, eyes: 0.01, lower: 0.2 } } });
    expect(scoreStructural(wide, { beardOverJaw: true }).subs.jawline).toBe(5.5);
    expect(scoreStructural(wide, noBeard).subs.jawline).toBeLessThan(5.5);
    // Uçtan uca: tam sakal + net hat, bant içi geometride sakalsızla her alt skorda aynı.
    const bearded = scoreFromVotes(GEO, CTX, obs({ grooming: { facialHair: "full_beard", facialHairEdges: "defined" } }));
    const shaven = scoreFromVotes(GEO, CTX, REF_OBS);
    expect(bearded.subscores).toEqual(shaven.subscores);
  });

  it("poz süzülmüş metriklerde g = 1; tüm-kare rampaları sürekli (yaw 8,9 vs 9,1 < 0,01)", () => {
    const outside = { jawRatio: 1.1, ipdRatio: 0.6, lowerToMiddle: 1.6, symmetry: { face: 0.1, eyes: 0.1, lower: 0.1 }, eyeMouthRatio: 0.5 };
    // Genel skorda (ham) 0,2° fark < 0,01: kapıda sıçrama yok (bant dışındaki en ağır tek bileşen, jawWidth).
    const a = scoreFromVotes(geo({ quality: { yaw: 8.9 }, metrics: { jawRatio: 1.2 } }), CTX, REF_OBS);
    const b = scoreFromVotes(geo({ quality: { yaw: 9.1 }, metrics: { jawRatio: 1.2 } }), CTX, REF_OBS);
    expect(Math.abs(a.rawOverall - b.rawOverall)).toBeLessThan(0.01);
    expect(Math.abs(a.rawOverall - b.rawOverall)).toBeGreaterThan(0);
    const turned = scoreStructural(geo({ quality: { yaw: 11, pitch: 11 }, metrics: outside }), noBeard);
    const sym = turned.components.find((c) => c.key === "symFace")!;
    expect(sym.gate).toBe(1);
    expect(turned.components.find((c) => c.key === "jawWidth")!.gate).toBeCloseTo(0.25, 9);
    expect(turned.poseLimited).toBe(true);
    // Kapı yalnız referansa doğru çeker: daha çok dönük → ceza azalır, artmaz.
    expect(turned.subs.jawline).toBeGreaterThan(scoreStructural(geo({ metrics: outside }), noBeard).subs.jawline);
    expect(scoreStructural(geo({ quality: { yaw: 12 }, metrics: outside }), noBeard).components.find((c) => c.key === "spacing")!.status).toBe(
      "not_measured",
    );
  });

  it("en büyük etkiler §3.5 ile eşleşir; toplam 0,80; alt skorlar [3,5, 5,5]", () => {
    const worst = geo({
      metrics: { jawRatio: 2, ipdRatio: 0.8, lowerToMiddle: 3, eyeMouthRatio: 0.7, canthalTiltDeg: 40, symmetry: { face: 0.3, eyes: 0.3, lower: 0.3 } },
    });
    const r = scoreStructural(worst, noBeard);
    expect(r.subs).toEqual({ harmony: 3.5, eyes: 3.5, jawline: 3.5 });
    const expected: Record<ComponentKey, number> = {
      symFace: 0.135,
      vertical: 0.09,
      eyeMouth: 0.075,
      spacing: 0.08,
      symEyes: 0.07,
      tilt: 0.05,
      jawWidth: 0.165,
      symLower: 0.135,
    };
    let total = 0;
    for (const k of Object.keys(BANDS) as ComponentKey[]) {
      const eff = WEIGHTS_H1[BANDS[k].sub] * STRUCT.amp * BANDS[k].w;
      expect(eff).toBeCloseTo(expected[k], 9);
      total += eff;
    }
    expect(total).toBeCloseTo(0.8, 9);
  });

  it("lengthRatio, fwhr, foreheadRatio, thirds.upper, brightness ve relaxed hiçbir skoru değiştirmez", () => {
    const base = scoreFromVotes(GEO, CTX, REF_OBS);
    const odd = geo({
      quality: { brightness: 20, relaxed: true, sharpness: 1 },
      metrics: { lengthRatio: 2.5, fwhr: 3.5, foreheadRatio: 1.8, thirds: { upper: 0.6, middle: 0.2, lower: 0.2 }, hairlineFound: true },
    });
    const r = scoreFromVotes(odd, CTX, REF_OBS);
    expect(r.subscores).toEqual(base.subscores);
    expect(r.overall).toBe(base.overall);
    expect(r.potential).toBe(base.potential);
  });
});
