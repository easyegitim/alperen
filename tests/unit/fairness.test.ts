import { describe, expect, it } from "vitest";
import { dimensionResult, FAIRNESS_MAX_GAP, fairnessSummary, type FairnessItem } from "@/lib/score/fairness";

const mk = (skinTone: string, gender: string, overall: number): FairnessItem => ({ groups: { skinTone, gender }, overall });

describe("adalet ölçümü (SPEC 8.8)", () => {
  it("gruplar arası fark ≤ 0,5 ise geçer", () => {
    const items = [mk("I", "m", 5.5), mk("I", "f", 5.7), mk("I", "m", 5.6), mk("VI", "f", 5.4), mk("VI", "m", 5.6), mk("VI", "f", 5.5)];
    const r = dimensionResult("skinTone", items);
    expect(r.groups.map((g) => g.name)).toEqual(["I", "VI"]);
    expect(r.maxGap).toBeCloseTo(0.1, 5);
    expect(r.pass).toBe(true);
    expect(fairnessSummary(items).pass).toBe(true);
  });
  it("bir grup sistematik olarak > 0,5 düşükse yayın durur", () => {
    const items = [mk("I", "m", 6.2), mk("I", "f", 6.3), mk("I", "m", 6.1), mk("VI", "f", 5.4), mk("VI", "m", 5.5), mk("VI", "f", 5.3)];
    const r = dimensionResult("skinTone", items);
    expect(r.maxGap).toBeGreaterThan(FAIRNESS_MAX_GAP);
    expect(r.pass).toBe(false);
    expect(r.ratio).toBeGreaterThan(1);
    expect(fairnessSummary(items).pass).toBe(false);
  });
  it("küçük gruplar (n < 3) değerlendirmeye girmez; tek grup kalan boyut özetten düşer", () => {
    const items = [mk("I", "m", 6), mk("I", "m", 6.1), mk("I", "m", 6.2), mk("III", "f", 4)];
    expect(dimensionResult("skinTone", items).groups).toHaveLength(1);
    expect(fairnessSummary(items).dimensions.find((d) => d.dimension === "skinTone")).toBeUndefined();
  });
});
