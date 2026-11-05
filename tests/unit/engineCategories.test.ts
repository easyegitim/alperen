import { describe, expect, it } from "vitest";
import { ORDER, type Observation } from "@/lib/ai/observationSchema";
import {
  CATEGORY_DELTAS,
  FLIP_BUDGET,
  GATE_BUDGET,
  ITEM_FIELDS,
  MOD_GAIN,
  SCORED_ITEMS,
  WEIGHTS_H1,
  WEIGHTS_H1_HAIR_EXCLUDED,
  type ItemKey,
} from "@/lib/config/engine.server";
import { scoreFromVotes } from "@/lib/score/engine";
import { scoreModifiable } from "@/lib/score/engine/categories";
import type { HybridContext } from "@/lib/score/engine/types";
import { BEST_OBS, CTX, GEO, REF_OBS, UNTENDED_OBS, obs } from "../helpers/engineFixtures";

const female: HybridContext = { ...CTX, presentation: "female" };

describe("kategori tabloları (engine spec §4)", () => {
  it("referans profil her alt skorda 5,5", () => {
    expect(scoreModifiable(REF_OBS, CTX).subs).toEqual({ skin: 5.5, hair: 5.5, grooming: 5.5 });
    expect(scoreModifiable(REF_OBS, CTX).notAssessed).toEqual([]);
  });

  it("aralıklar: cilt 2,6–8,1 · saç 3,5–7,5 · bakım 3,7–6,3", () => {
    const best = scoreModifiable(BEST_OBS, CTX).subs;
    expect(best.skin).toBeCloseTo(8.1, 9);
    expect(best.hair).toBeCloseTo(7.5, 9);
    expect(best.grooming).toBeCloseTo(6.3, 9);
    const low = scoreModifiable(UNTENDED_OBS, CTX).subs;
    expect(low.skin).toBeCloseTo(2.6, 9);
    expect(low.hair).toBeCloseTo(3.5, 9);
    expect(low.grooming).toBeCloseTo(3.7, 9);
  });

  it("evenness her kategoride 0 delta; skoru değiştirmez", () => {
    expect(Object.values(CATEGORY_DELTAS.evenness)).toEqual([0, 0, 0]);
    for (const evenness of ["even", "mostly_even", "uneven", "unclear"] as const) {
      expect(scoreModifiable(obs({ skin: { evenness } }), CTX).subs.skin).toBe(5.5);
    }
  });

  it("kaş tidy ≡ few_strays", () => {
    expect(scoreModifiable(obs({ grooming: { brows: "tidy" } }), CTX).subs.grooming).toBe(
      scoreModifiable(obs({ grooming: { brows: "few_strays" } }), CTX).subs.grooming,
    );
  });
});

describe("saç: hariç / görünmüyor / değerlendirildi", () => {
  it("başörtüsü beyanı Claude 'visible' dese de saçı hariç tutar; ağırlık cilt ve bakıma gider", () => {
    const r = scoreModifiable(obs({ hair: { visibility: "visible", neatness: "neat", shape: "defined" } }), { ...CTX, headCovering: true });
    expect(r.hairExcluded).toBe(true);
    expect(r.weights).toEqual(WEIGHTS_H1_HAIR_EXCLUDED);
    expect(r.subs.hair).toBe(5.5);
    expect(r.notAssessed).toEqual([{ sub: "hair", reason: "excluded" }]);
  });

  it("no_visible_hair aynı biçimde hariç tutar", () => {
    const r = scoreModifiable(obs({ hair: { visibility: "no_visible_hair", neatness: "unclear", shape: "unclear" } }), CTX);
    expect(r.weights).toEqual(WEIGHTS_H1_HAIR_EXCLUDED);
    expect(r.notAssessed).toEqual([{ sub: "hair", reason: "excluded" }]);
  });

  it("not_visible → saç referansla doldurulur (κ = 0), standart ağırlıklar", () => {
    const r = scoreModifiable(obs({ hair: { visibility: "not_visible", neatness: "neat", shape: "grown_out" } }), CTX);
    expect(r.kappa.hair).toBe(0);
    expect(r.subs.hair).toBe(5.5);
    expect(r.weights).toEqual(WEIGHTS_H1);
    expect(r.notAssessed).toEqual([{ sub: "hair", reason: "not_visible" }]);
  });

  it("referans profil saç hariç de 5,50; ağırlık setleri 1'e toplanır ve yapı 0,40 kalır", () => {
    const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);
    expect(sum(WEIGHTS_H1)).toBeCloseTo(1, 12);
    expect(sum(WEIGHTS_H1_HAIR_EXCLUDED)).toBeCloseTo(1, 12);
    expect(WEIGHTS_H1_HAIR_EXCLUDED.harmony + WEIGHTS_H1_HAIR_EXCLUDED.eyes + WEIGHTS_H1_HAIR_EXCLUDED.jawline).toBeCloseTo(0.4, 12);
    expect(scoreFromVotes(GEO, { ...CTX, headCovering: true }, REF_OBS).overall).toBe(5.5);
  });
});

describe("fotoğraf kapıları", () => {
  it("obscured → cilt referansla doldurulur; partly_obscured κ'yı küçültmez", () => {
    const r = scoreModifiable(obs({ photo: { skinVisibility: "obscured" }, skin: { blemishes: "many" } }), CTX);
    expect(r.subs.skin).toBe(5.5);
    expect(r.notAssessed).toEqual([{ sub: "skin", reason: "not_visible" }]);
    expect(scoreModifiable(obs({ photo: { skinVisibility: "partly_obscured" }, skin: { blemishes: "none" } }), CTX).subs.skin).toBe(6.5);
  });

  it("harsh_or_dim parlamayı belirsiz sayar", () => {
    const r = scoreModifiable(obs({ photo: { lighting: "harsh_or_dim" }, skin: { shine: "balanced" } }), CTX);
    expect(r.effective.shine).toBe("unclear");
    expect(r.subs.skin).toBe(5.5);
  });

  it("retouch likely cildi asla referansın üstüne çıkarmaz; possible pozitifleri yarılar; negatifler korunur", () => {
    expect(scoreModifiable(obs({ photo: { retouch: "likely" } }, BEST_OBS), CTX).subs.skin).toBe(5.5);
    expect(scoreModifiable(obs({ photo: { retouch: "possible" } }, BEST_OBS), CTX).subs.skin).toBeCloseTo(5.5 + 1.3, 9);
    expect(scoreModifiable(obs({ photo: { retouch: "likely" } }, UNTENDED_OBS), CTX).subs.skin).toBeCloseTo(2.6, 9);
  });

  it("her öğe belirsizse alt skor referansta ve not_visible listelenir", () => {
    const r = scoreModifiable(obs({ grooming: { brows: "unclear", lips: "unclear" } }), CTX);
    expect(r.subs.grooming).toBe(5.5);
    expect(r.notAssessed).toEqual([{ sub: "grooming", reason: "not_visible" }]);
  });
});

describe("sakal (engine spec §4.4)", () => {
  it("kadın + kirli sakal = kadın + sakal yok; sakal metni ve kaldıracı yok", () => {
    const withHair = scoreFromVotes(GEO, female, obs({ grooming: { facialHair: "stubble", facialHairEdges: "untidy" } }));
    const without = scoreFromVotes(GEO, female, REF_OBS);
    expect(withHair.subscores.grooming).toBe(without.subscores.grooming);
    expect(JSON.stringify(withHair.observations)).not.toMatch(/Sakal/i);
    expect(withHair.improveFirst.some((i) => i.lever === "lv_beard_lineup")).toBe(false);
  });

  it("sakal tercihi 'hiçbiri' iken de puanlanmaz", () => {
    const none: HybridContext = { ...CTX, beardPreference: "none" };
    const r = scoreModifiable(obs({ grooming: { facialHair: "full_beard", facialHairEdges: "untidy" } }), none);
    expect(r.edgesScored).toBe(false);
    expect(r.subs.grooming).toBe(5.5);
  });

  it("net veya yumuşak hatlı sakal, sakalsızla her alt skorda aynı; düzensiz hat −0,5", () => {
    const shaven = scoreFromVotes(GEO, CTX, REF_OBS).subscores;
    for (const facialHairEdges of ["defined", "soft"] as const) {
      for (const facialHair of ["stubble", "short_beard", "full_beard"] as const) {
        expect(scoreFromVotes(GEO, CTX, obs({ grooming: { facialHair, facialHairEdges } })).subscores).toEqual(shaven);
      }
    }
    expect(scoreModifiable(obs({ grooming: { facialHair: "stubble", facialHairEdges: "untidy" } }), CTX).subs.grooming).toBe(5);
  });

  it("bakım tavanı her sunum × sakal durumunda 6,3", () => {
    for (const presentation of ["male", "female", "unspecified"] as const) {
      for (const facialHair of ["none_visible", "stubble", "short_beard", "full_beard", "unclear"] as const) {
        const edges = facialHair === "none_visible" || facialHair === "unclear" ? "not_applicable" : "defined";
        const r = scoreModifiable(obs({ grooming: { facialHair, facialHairEdges: edges } }, BEST_OBS), { ...CTX, presentation });
        expect(r.subs.grooming).toBeCloseTo(6.3, 9);
      }
    }
  });
});

/** Saf bir yeniden puanlamayla genel skor (yapı bant içinde). */
function overallOf(o: Observation, ctx: HybridContext = CTX): number {
  return scoreFromVotes(GEO, ctx, o).rawOverall;
}

describe("dönüşüm bütçeleri (engine spec §4.5)", () => {
  it("her derecelendirilen komşu adım w × |Δ| × MOD_GAIN ≤ 0,20 (saç hariç ≤ 0,30)", () => {
    for (const sub of ["skin", "hair", "grooming"] as const) {
      for (const item of SCORED_ITEMS[sub]) {
        const { group, field } = ITEM_FIELDS[item];
        const order = ORDER[`${group}.${field}` as keyof typeof ORDER] as readonly string[];
        const deltas = CATEGORY_DELTAS[item] as Record<string, number>;
        for (let i = 1; i < order.length; i++) {
          const step = Math.abs(deltas[order[i]] - deltas[order[i - 1]]) * MOD_GAIN;
          expect(WEIGHTS_H1[sub] * step).toBeLessThanOrEqual(FLIP_BUDGET.standard + 1e-9);
          expect(WEIGHTS_H1_HAIR_EXCLUDED[sub] * step).toBeLessThanOrEqual(FLIP_BUDGET.hairExcluded + 1e-9);
        }
      }
    }
  });

  it("uçtan uca komşu adım: genel skor farkı bütçe içinde (öğe dışı alanlar referansta)", () => {
    const ctxs: [HybridContext, number][] = [
      [CTX, FLIP_BUDGET.standard],
      [{ ...CTX, headCovering: true }, FLIP_BUDGET.hairExcluded],
    ];
    const items: ItemKey[] = ["blemishes", "texture", "shine", "hairNeat", "hairShape", "brows", "lips", "facialHairEdges"];
    for (const [ctx, budget] of ctxs) {
      for (const item of items) {
        const { group, field } = ITEM_FIELDS[item];
        const order = ORDER[`${group}.${field}` as keyof typeof ORDER] as readonly string[];
        for (let i = 1; i < order.length; i++) {
          const base = item === "facialHairEdges" ? obs({ grooming: { facialHair: "stubble" } }) : REF_OBS;
          const at = (cat: string) => overallOf(obs({ [group]: { [field]: cat } }, base), ctx);
          expect(Math.abs(at(order[i]) - at(order[i - 1]))).toBeLessThanOrEqual(budget + 1e-9);
        }
      }
    }
  });

  it("retouch ve ışık kapıları en kötü durumda ≤ 0,35 (saç hariç ≤ 0,40)", () => {
    for (const [ctx, budget] of [
      [CTX, GATE_BUDGET.standard],
      [{ ...CTX, headCovering: true }, GATE_BUDGET.hairExcluded],
    ] as const) {
      const r = (retouch: Observation["photo"]["retouch"]) => overallOf(obs({ photo: { retouch } }, BEST_OBS), ctx);
      expect(Math.abs(r("none") - r("possible"))).toBeLessThanOrEqual(budget + 1e-9);
      expect(Math.abs(r("possible") - r("likely"))).toBeLessThanOrEqual(budget + 1e-9);
      const l = (lighting: Observation["photo"]["lighting"]) => overallOf(obs({ photo: { lighting } }, BEST_OBS), ctx);
      expect(Math.abs(l("uneven") - l("harsh_or_dim"))).toBeLessThanOrEqual(budget + 1e-9);
    }
    // Belgelenmiş değerler: retouch 0,26 (0,39), ışık 0,12 (0,18).
    expect(overallOf(BEST_OBS) - overallOf(obs({ photo: { retouch: "possible" } }, BEST_OBS))).toBeCloseTo(0.26, 9);
    expect(overallOf(BEST_OBS) - overallOf(obs({ photo: { lighting: "harsh_or_dim" } }, BEST_OBS))).toBeCloseTo(0.12, 9);
  });
});
