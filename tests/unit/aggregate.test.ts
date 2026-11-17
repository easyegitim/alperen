import { describe, expect, it } from "vitest";
import type { ScoreOutput } from "@/lib/ai/scoreSchema";
import { aggregateScores, median, weightedOverall } from "@/lib/score/aggregate";

function out(overrides: Partial<ScoreOutput["subscores"]> = {}, extra: Partial<ScoreOutput> = {}): ScoreOutput {
  return {
    subscores: { harmony: 6, eyes: 6, jawline: 6, skin: 6, hair: 6, grooming: 6, ...overrides },
    achievableGain: {
      skin: { value: 1, lever: "nemlendirici" },
      hair: { value: 0.5, lever: "kesim" },
      grooming: { value: 0.5, lever: "kaş" },
      jawline: { value: 0.2, lever: "sakal" },
    },
    observations: { skin: "a", hair: "b", brows: "c", facialHair: "d" },
    flags: { visibleSkinConcern: false, skinConcernNote: null, multiplePeopleOrNotAFace: false },
    ...extra,
  };
}
const ok = (v: ScoreOutput): PromiseSettledResult<ScoreOutput> => ({ status: "fulfilled", value: v });
const fail = (): PromiseSettledResult<ScoreOutput> => ({ status: "rejected", reason: new Error("x") });

describe("aggregateScores (SPEC 8.2)", () => {
  it("3 çağrıda alt skor medyanı", () => {
    const a = aggregateScores([ok(out({ skin: 5 })), ok(out({ skin: 7 })), ok(out({ skin: 9 }))]);
    expect(a.rawSubscores.skin).toBe(7);
    expect(a.samples).toBe(3);
  });
  it("1 başarısızsa 2 değerin ortalaması", () => {
    const a = aggregateScores([ok(out({ skin: 5 })), fail(), ok(out({ skin: 7 }))]);
    expect(a.rawSubscores.skin).toBe(6);
    expect(a.samples).toBe(2);
  });
  it("2 başarısızsa AI_FAILED", () => {
    expect(() => aggregateScores([ok(out()), fail(), fail()])).toThrow(/çoğu başarısız/);
  });
  it("yüz yok bayrağı çoğunluktaysa NO_FACE", () => {
    const nf = out({}, { flags: { visibleSkinConcern: false, skinConcernNote: null, multiplePeopleOrNotAFace: true } });
    expect(() => aggregateScores([ok(nf), ok(nf), ok(out())])).toThrow(/tek bir yüz/);
    // azınlıkta ise o çağrı dışlanır
    const a = aggregateScores([ok(nf), ok(out({ skin: 7 })), ok(out({ skin: 7 }))]);
    expect(a.rawSubscores.skin).toBe(7);
    expect(a.samples).toBe(2);
    expect(a.flags.multiplePeopleOrNotAFace).toBe(false);
  });
  it("ham genel skor ağırlıklı toplam", () => {
    const a = aggregateScores([ok(out({ harmony: 8 })), ok(out({ harmony: 8 })), ok(out({ harmony: 8 }))]);
    expect(a.rawOverall).toBeCloseTo(0.25 * 8 + 0.75 * 6, 6);
    expect(weightedOverall({ harmony: 10, eyes: 10, jawline: 10, skin: 10, hair: 10, grooming: 10 })).toBeCloseTo(10, 6);
  });
  it("kazanç medyanı ve en yakın çağrının kaldıracı", () => {
    const g = (v: number, lever: string) => out({}, { achievableGain: { ...out().achievableGain, skin: { value: v, lever } } });
    const a = aggregateScores([ok(g(0.2, "az")), ok(g(1.0, "orta")), ok(g(1.8, "çok"))]);
    expect(a.gains.skin).toEqual({ value: 1.0, lever: "orta" });
  });
  it("cilt uyarısı çoğunlukla belirlenir", () => {
    const c = out({}, { flags: { visibleSkinConcern: true, skinConcernNote: "kızarıklık", multiplePeopleOrNotAFace: false } });
    expect(aggregateScores([ok(c), ok(c), ok(out())]).flags.visibleSkinConcern).toBe(true);
    expect(aggregateScores([ok(c), ok(out()), ok(out())]).flags.visibleSkinConcern).toBe(false);
  });
  it("median", () => {
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 9])).toBe(5);
  });
});
