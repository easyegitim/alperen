import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Observation } from "@/lib/ai/observationSchema";
import { scoreHybrid } from "@/lib/score/engine";
import type { HybridContext } from "@/lib/score/engine/types";
import { ClientSignals, LEVER_KEYS } from "@/lib/score/contract";
import { toClientAnalysis, type AnalysisRow } from "@/lib/score/present";
import { BEST_OBS, CTX, FakeProvider, GEO, IMG, REF_OBS, UNTENDED_OBS, geo, obs, ok } from "../helpers/engineFixtures";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function score(o: Observation, ctx: HybridContext, g = GEO) {
  const p = scoreHybrid(IMG, g, ctx, new FakeProvider([ok(o, 10), ok(o, 20), ok(o, 30)]), { calls: 3 });
  await vi.advanceTimersByTimeAsync(100);
  return p;
}

const CTXS: HybridContext[] = [
  CTX,
  { ...CTX, presentation: "female" },
  { ...CTX, presentation: "unspecified", beardPreference: "none" },
  { ...CTX, headCovering: true },
  { headCovering: true, presentation: "female", beardPreference: "none" },
];

const OBS: Observation[] = [
  REF_OBS,
  BEST_OBS,
  UNTENDED_OBS,
  ...(["visible", "very_short", "partly_visible", "no_visible_hair", "not_visible"] as const).map((visibility) => obs({ hair: { visibility } })),
  obs({ photo: { skinVisibility: "obscured" } }, UNTENDED_OBS),
  obs({ photo: { retouch: "likely", lighting: "harsh_or_dim" } }, BEST_OBS),
  obs({ photo: { retouch: "possible", lighting: "uneven" }, grooming: { facialHair: "full_beard", facialHairEdges: "untidy" } }),
  obs({ skin: { blemishes: "unclear", texture: "unclear", shine: "unclear" }, grooming: { brows: "unclear", lips: "unclear" } }),
];

describe("signals sözleşmesi (engine spec §7.3, UI spec §1.1 C14)", () => {
  it("ClientSignals.parse(scoreHybrid(...).signals) tüm fikstür matrisinde başarılı; 'covered'/'hijab' yok", async () => {
    let n = 0;
    for (const ctx of CTXS) {
      for (const o of OBS) {
        for (const g of [GEO, geo({ quality: { yaw: 10 }, metrics: { symmetry: null, ipdRatio: null } })]) {
          const r = await score(o, ctx, g);
          const parsed = ClientSignals.safeParse(r.signals);
          expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
          const json = JSON.stringify(r.signals);
          expect(json).not.toMatch(/covered|hijab/i);
          // Saklanan alt skorlar asla null değil; değerlendirilmeyen alt skorun kaldıracı yok (C9).
          for (const v of Object.values(r.subscores)) expect(typeof v).toBe("number");
          for (const i of r.signals.improveFirst) {
            expect(r.signals.notAssessed.some((na) => na.sub === i.sub)).toBe(false);
            expect(LEVER_KEYS).toContain(i.lever);
          }
          if (ctx.headCovering) expect(r.signals.notAssessed).toContainEqual({ sub: "hair", reason: "excluded" });
          n++;
        }
      }
    }
    expect(n).toBe(CTXS.length * OBS.length * 2);
  });

  it("present.ts ile uçtan uca: ücretsiz satırda kilitli değer, kaldıraç veya delta yok; başörtüsünde saç açık '–'", async () => {
    const r = await score(REF_OBS, { ...CTX, headCovering: true });
    const row: AnalysisRow = {
      id: "a1",
      status: "completed",
      created_at: "2026-10-30T10:00:00Z",
      face_shape: "oval",
      overall: r.overall,
      potential: r.potential,
      subscores: r.subscores,
      gains: r.gains,
      observations: r.observations,
      geometry: GEO,
      calibration_version: "h1",
      prompt_version: "observe.v1",
      engine_version: "hybrid.v1",
      signals: r.signals,
    };
    const free = toClientAnalysis(row, false, "shape_plus_one", "skin");
    const json = JSON.stringify(free);
    expect(json).not.toMatch(/lv_|"potentialDelta":\{"value":\d|"improveFirst":\{"value":\[/);
    expect(free.subscores.hair).toEqual({ value: null, locked: false });
    expect(free.notAssessed).toContainEqual({ sub: "hair", reason: "excluded" });
    expect(free.kinds.jawline).toBe("structural");
    const premium = toClientAnalysis(row, true, "shape_plus_one", "skin");
    expect(premium.improveFirst.value?.length).toBeGreaterThan(0);
    expect(premium.explain.harmony.value?.every((e) => e.status === "measured" || e.status === "not_measured")).toBe(true);
  });
});
