import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import { CONSENSUS } from "@/lib/config/engine.h2.server";
import { SUB_KEYS_V2 } from "@/lib/config/teaser";
import { collectRuns, consensus, medianOf, nearestRunIndex, needsExtraRun, perSubMedian, perSubSpread, vectorOf, type RunVector } from "@/lib/score/engine/consensus";
import { FakeScoringV2, IMAGES, failRun, okRun, scoreOutput } from "../helpers/engineV2Fixtures";

// Ortanca-3 (KB §4.1–4.2): alt skor bazında ortanca; yayılım > 0,5 → 4. çalıştırma; metin ortancaya en yakından.

const vec = (v: number, over: Partial<RunVector> = {}): RunVector => ({ ...(Object.fromEntries(SUB_KEYS_V2.map((k) => [k, v])) as RunVector), ...over });

describe("saf ortanca", () => {
  it("medianOf: tek, çift, sırasız", () => {
    expect(medianOf([5.5])).toBe(5.5);
    expect(medianOf([6, 5, 7])).toBe(6);
    expect(medianOf([5, 6, 7, 8])).toBe(6.5);
    expect(Number.isNaN(medianOf([]))).toBe(true);
  });
  it("perSubMedian / perSubSpread / needsExtraRun eşiği 0,5 (tam 0,5 tetiklemez)", () => {
    const runs = [vec(5.5, { skin: 6.0 }), vec(5.5, { skin: 6.5 }), vec(5.5, { skin: 5.9 })];
    expect(perSubMedian(runs).skin).toBe(6.0);
    expect(perSubSpread(runs).skin).toBeCloseTo(0.6, 10);
    expect(perSubSpread(runs).hair).toBe(0);
    expect(needsExtraRun(runs)).toBe(true);
    expect(needsExtraRun([vec(5.5, { skin: 6.0 }), vec(5.5, { skin: 6.5 })])).toBe(false);
    expect(needsExtraRun([vec(5)])).toBe(false);
    expect(CONSENSUS).toEqual({ runs: 3, extraRunIfSpread: 0.5, maxRuns: 4 });
  });
  it("nearestRunIndex: Σ|fark| en küçük; eşitlikte ilk", () => {
    const runs = [vec(5.5, { skin: 7 }), vec(5.5, { skin: 6 }), vec(5.5, { skin: 5 })];
    const c = consensus(runs);
    expect(c.median.skin).toBe(6);
    expect(c.nearest).toBe(1);
    expect(c.maxSpread).toBe(2);
    expect(nearestRunIndex([vec(5), vec(5)], vec(5))).toBe(0);
  });
  it("4 çalıştırmada ortanca ortadaki ikinin ortalaması (KB: dördün ortancası)", () => {
    expect(perSubMedian([vec(5), vec(6), vec(7), vec(9)]).skin).toBe(6.5);
  });
});

describe("collectRuns", () => {
  it("3 paralel çalıştırma, yayılım küçük → ek çalıştırma yok; kullanım modele göre toplanır", async () => {
    const p = new FakeScoringV2([okRun(scoreOutput({ skin: 6 })), okRun(scoreOutput({ skin: 6.2 })), okRun(scoreOutput({ skin: 6.4 }))]);
    const r = await collectRuns(p, IMAGES, "ctx");
    expect(r.samples).toHaveLength(3);
    expect(r.extraRun).toBe("none");
    expect(r.attempts).toBe(3);
    expect(p.imageCounts).toEqual([2, 2, 2]);
    expect(r.usageByModel.get("claude-opus-5-5")?.input).toBe(15000);
    expect(consensus(r.samples.map(vectorOf)).median.skin).toBe(6.2);
  });
  it("herhangi bir alt skorda yayılım > 0,5 → dördüncü çalıştırma; sonuç dördün ortancası", async () => {
    const p = new FakeScoringV2([okRun(scoreOutput({ hair: 5 })), okRun(scoreOutput({ hair: 6 })), okRun(scoreOutput({ hair: 7 })), okRun(scoreOutput({ hair: 6.4 }))]);
    const r = await collectRuns(p, IMAGES, "ctx");
    expect(r.samples).toHaveLength(4);
    expect(r.extraRun).toBe("done");
    expect(consensus(r.samples.map(vectorOf)).median.hair).toBe(6.2);
  });
  it("geçici hata bir kez yeniden denenir; ret kardeşleri iptal etmez; fatal kardeşleri durdurur", async () => {
    const p = new FakeScoringV2([failRun("transient"), okRun(scoreOutput()), okRun(scoreOutput()), okRun(scoreOutput())]);
    const r = await collectRuns(p, IMAGES, "ctx");
    expect(r.samples).toHaveLength(3);
    expect(r.attempts).toBe(4);
    expect(r.reasons).toEqual(["transient"]);

    const f = new FakeScoringV2([failRun("fatal", 1, { status: 400 }), okRun(scoreOutput(), 30), okRun(scoreOutput(), 30)]);
    const rf = await collectRuns(f, IMAGES, "ctx");
    expect(rf.fatal?.reason).toBe("fatal");
    expect(rf.samples.length).toBeLessThan(3);
  });
  it("iki ret → yeter sayı yok (motor AI_SAFETY_BLOCKED üretir)", async () => {
    const p = new FakeScoringV2([failRun("refusal"), failRun("refusal"), okRun(scoreOutput())]);
    const r = await collectRuns(p, IMAGES, "ctx");
    expect(r.samples).toHaveLength(1);
    expect(r.reasons.filter((x) => x === "refusal")).toHaveLength(2);
    expect(new ApiError("AI_SAFETY_BLOCKED", "x").code).toBe("AI_SAFETY_BLOCKED");
  });
  it("süre kalmadıysa ek çalıştırma atlanır ve işaretlenir", async () => {
    let t = 0;
    const now = () => t;
    const p = new FakeScoringV2([
      okRun(scoreOutput({ hair: 5 })),
      okRun(scoreOutput({ hair: 6 })),
      async (signal) => {
        t += 200_000;
        return okRun(scoreOutput({ hair: 7 }))(signal, 2);
      },
    ]);
    const r = await collectRuns(p, IMAGES, "ctx", { now });
    expect(r.samples).toHaveLength(3);
    expect(r.extraRun).toBe("skipped_time");
  });
});
