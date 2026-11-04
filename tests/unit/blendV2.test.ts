import { describe, expect, it } from "vitest";
import { BLEND_CLAUDE_WEIGHT, STRUCTURAL_SUBS_H2, getStructuralSource } from "@/lib/config/engine.h2.server";
import { GEOMETRY_TO_RUBRIC, blendStructural, geometryToRubric, structuralFromGeometry } from "@/lib/score/engine/blend";
import { GEO, geo } from "../helpers/engineFixtures";

// Yapısal üçlü kaynağı (PLAN_V2 Ç-A, 3g): 0,5 Claude + 0,5 geometri bant puanı; env ile claude | geometry | blend.

describe("blendStructural", () => {
  it("blend: 0,5·Claude + 0,5·geometri; geometri referansı 5,5 aynı ölçekte", () => {
    expect(GEOMETRY_TO_RUBRIC).toEqual({ reference: 5.5, scale: 1 });
    expect(geometryToRubric(5.5)).toBe(5.5);
    expect(geometryToRubric(3.5)).toBe(3.5);
    expect(blendStructural(7, 5.5, "blend")).toEqual({ value: 6.25, used: "blend" });
    expect(blendStructural(7, 4.5, "blend")).toEqual({ value: 5.75, used: "blend" });
    expect(BLEND_CLAUDE_WEIGHT).toBe(0.5);
  });
  it("claude ve geometry kaynakları tek ayarla; ölçülemeyen geometri → Claude", () => {
    expect(blendStructural(7, 4.5, "claude")).toEqual({ value: 7, used: "claude" });
    expect(blendStructural(7, 4.5, "geometry")).toEqual({ value: 4.5, used: "geometry" });
    expect(blendStructural(7, null, "blend")).toEqual({ value: 7, used: "claude" });
    expect(blendStructural(7, null, "geometry")).toEqual({ value: 7, used: "claude" });
    expect(getStructuralSource({})).toBe("blend");
    expect(getStructuralSource({ STRUCTURAL_SOURCE: "geometry" })).toBe("geometry");
    expect(getStructuralSource({ STRUCTURAL_SOURCE: "x" })).toBe("blend");
  });
  it("structuralFromGeometry: bant içindeki referans profil 5,5; sakal çeneyi ölçülmedi yapar (null)", () => {
    const r = structuralFromGeometry(GEO, { beardOverJaw: false });
    for (const s of STRUCTURAL_SUBS_H2) expect(r[s]).toBe(5.5);
    const beard = structuralFromGeometry(GEO, { beardOverJaw: true });
    expect(beard.jawline).toBeNull();
    expect(beard.harmony).toBe(5.5);
    const asym = structuralFromGeometry(geo({ metrics: { symmetry: { face: 0.028, eyes: 0.01, lower: 0.01 } } }), { beardOverJaw: false });
    expect(asym.harmony).toBeCloseTo(5.32, 10);
  });
});
