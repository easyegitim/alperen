import { describe, expect, it } from "vitest";
import { PROGRESS_STAGES, finishProgress, markDone, progressValue, startProgress, type ProgressState } from "@/lib/analysis/progressModel";

function through(...stages: (typeof PROGRESS_STAGES)[number][]): ProgressState {
  return stages.reduce(markDone, startProgress(0));
}

describe("progressModel (UI spec §3)", () => {
  it("adımlar sırayla tamamlanır, etkin adım sıradaki", () => {
    const s0 = startProgress(1000);
    expect(s0).toEqual({ done: [], active: "landmarks", startedAt: 1000, finished: false });
    const s1 = markDone(s0, "landmarks");
    expect(s1.active).toBe("ratios");
    const s3 = markDone(markDone(s1, "ratios"), "prepare");
    expect(s3.done).toEqual(["landmarks", "ratios", "prepare"]);
    expect(s3.active).toBe("observe");
    expect(markDone(s3, "prepare")).toBe(s3);
    const end = finishProgress(markDone(markDone(s3, "observe"), "score"));
    expect(end).toMatchObject({ active: null, finished: true, done: [...PROGRESS_STAGES] });
  });

  it("ilk üç adım 0–40 arasını paylaşır", () => {
    expect(progressValue(startProgress(0), 0)).toBe(0);
    expect(progressValue(through("landmarks"), 0)).toBeCloseTo(40 / 3, 5);
    expect(progressValue(through("landmarks", "ratios"), 0)).toBeCloseTo(80 / 3, 5);
  });

  it("gözlem sırasında 40 + 50·(1 − e^(−t/12 sn)); 90'ı geçmez", () => {
    const s = through("landmarks", "ratios", "prepare");
    expect(progressValue(s, 0)).toBeCloseTo(40, 5);
    expect(progressValue(s, 12_000)).toBeCloseTo(40 + 50 * (1 - Math.exp(-1)), 5);
    expect(progressValue(s, 10 * 60_000)).toBeLessThanOrEqual(90);
  });

  it("tekdüze artar ve bitmeden 100 olmaz", () => {
    const states = [
      startProgress(0),
      through("landmarks"),
      through("landmarks", "ratios"),
      through("landmarks", "ratios", "prepare"),
    ];
    let prev = -1;
    for (const s of states) {
      const v = progressValue(s, 0);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    const observing = states[3];
    for (const t of [0, 1_000, 5_000, 20_000, 60_000, 600_000]) {
      const v = progressValue(observing, t);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThan(100);
      prev = v;
    }
    const observed = markDone(observing, "observe");
    expect(progressValue(observed, 600_000)).toBeGreaterThanOrEqual(prev);
    const scored = markDone(observed, "score");
    expect(progressValue(scored, 600_000)).toBeGreaterThan(progressValue(observed, 600_000));
    expect(progressValue(scored, 600_000)).toBeLessThan(100);
    expect(progressValue(finishProgress(scored), 0)).toBe(100);
  });
});
