import { describe, expect, it } from "vitest";
import type { Observation } from "@/lib/ai/observationSchema";
import type { GeometryResult } from "@/lib/face/types";
import { samplesCsv, summarize, type SampleRow } from "../../scripts/compare-observers";
import {
  assertNumbersOnly,
  cohenKappa,
  fivePhotoShare,
  flipRates,
  gapBy,
  inBandShare,
  positional,
  quantile,
  refitAcceptable,
  rescoreAtModGain,
  samePhotoShare,
  widenBand,
  type Band,
} from "../../scripts/engine-tooling";
import { engineFairness, type HybridRow } from "../../scripts/fairness-report";
import { refitBands, refitCategories } from "../../scripts/refit-engine";

// İz F araçlarının saf kısmı (engine spec §12, §13). Ağ yok, motor yüklenmez; ücretli yol çalıştırılmaz.

const OBS: Observation = {
  photo: { faceCount: "one", lighting: "even", skinVisibility: "clear", retouch: "none" },
  skin: { blemishes: "few", blemishZone: "none", texture: "slightly_uneven", evenness: "mostly_even", shine: "some", shineZone: "none", visibleSkinConcern: false, concernZone: "none" },
  hair: { visibility: "visible", neatness: "slightly_untidy", shape: "softening" },
  grooming: { brows: "few_strays", lips: "slightly_dry", facialHair: "none_visible", facialHairEdges: "not_applicable" },
};
const withObs = (patch: (o: Observation) => void): Observation => {
  const o = structuredClone(OBS);
  patch(o);
  return o;
};

describe("istatistik", () => {
  it("quantile ve κ", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([0, 10], 0.25)).toBe(2.5);
    expect(cohenKappa(["a", "b", "a", "b"], ["a", "b", "a", "b"])).toBe(1);
    expect(cohenKappa(["a", "a"], ["a", "a"])).toBe(1);
    expect(cohenKappa(["a", "b", "a", "b"], ["b", "a", "b", "a"])).toBeLessThan(0);
  });
  it("gapBy küçük grupları dışlar ve sınırla karşılaştırır", () => {
    const rows = [...Array(5).fill({ g: "x", v: 5 }), ...Array(5).fill({ g: "y", v: 5.2 }), { g: "z", v: 1 }];
    const r = gapBy(rows, "d", (x: { g: string; v: number }) => x.g, (rs) => rs.reduce((s, x) => s + x.v, 0) / rs.length, 0.1);
    expect(r.groups.map((g) => g.name)).toEqual(["x", "y"]);
    expect(r.gap).toBeCloseTo(0.2, 6);
    expect(r.pass).toBe(false);
  });
  it("flipRates: tekrar örneklerinde farklı değer görülen fotoğrafların payı; tek örnekli foto sayılmaz", () => {
    const other = withObs((o) => (o.hair.neatness = "neat"));
    const r = flipRates([[OBS, OBS], [OBS, other], [OBS]]);
    expect(r["hair.neatness"]).toBe(0.5);
    expect(r["skin.blemishes"]).toBe(0);
  });
  it("SPEC 8.6 payları", () => {
    expect(samePhotoShare([[5.5, 5.6, 5.9]])).toBeCloseTo(1 / 3, 6);
    expect(fivePhotoShare([[5, 5.1, 5.2], [4, 6], [5]])).toBe(0.5);
  });
});

describe("MOD_GAIN ile çevrimdışı yeniden puanlama", () => {
  const weights = { harmony: 0.15, eyes: 0.1, jawline: 0.15, skin: 0.2, hair: 0.2, grooming: 0.2 };
  it("g = mevcut → aynı genel; yapısal alt skor ölçeklenmez", () => {
    const raw = { harmony: 5.0, eyes: 5.5, jawline: 5.5, skin: 8.1, hair: 7.5, grooming: 6.3 };
    const base = rescoreAtModGain(raw, weights, 1);
    expect(base).toBe(Math.round((0.15 * 5 + 0.1 * 5.5 + 0.15 * 5.5 + 0.2 * 8.1 + 0.2 * 7.5 + 0.2 * 6.3) * 10) / 10);
    // engine spec §5.3: en iyi bakım, bant içi yapı → g=2'de ≈ 7,66.
    const best = { harmony: 5.5, eyes: 5.5, jawline: 5.5, skin: 8.1, hair: 7.5, grooming: 6.3 };
    expect(rescoreAtModGain(best, weights, 1)).toBe(6.6);
    expect(rescoreAtModGain(best, weights, 2)).toBe(7.7);
    const ref = { harmony: 5.5, eyes: 5.5, jawline: 5.5, skin: 5.5, hair: 5.5, grooming: 5.5 };
    expect(rescoreAtModGain(ref, weights, 2)).toBe(5.5);
  });
});

describe("bant yeniden uydurma (yalnız genişler)", () => {
  const prior: Band = { kind: "twoSided", c: 0.85, h: 0.1, r: 0.1 };
  it("dar bir dağılım önsel bandı daraltmaz", () => {
    const narrow = new Map([["all", Array.from({ length: 50 }, (_, i) => 0.84 + i * 0.0004)]]);
    const r = widenBand(prior, narrow);
    expect(r.band).toEqual(prior);
    expect(r.changed).toBe(false);
  });
  it("geniş bir alt grup bandı genişletir; hiçbir grubun payı düşmez", () => {
    const groups = new Map([
      ["a", Array.from({ length: 40 }, (_, i) => 0.7 + i * 0.005)],
      ["b", Array.from({ length: 40 }, (_, i) => 0.8 + i * 0.002)],
    ]);
    const r = widenBand(prior, groups);
    expect(r.changed).toBe(true);
    const check = refitAcceptable(prior, r.band, groups);
    expect(check.ok).toBe(true);
    for (const v of groups.values()) expect(inBandShare(v, r.band)).toBeGreaterThanOrEqual(inBandShare(v, prior));
  });
  it("daraltan veya bir grubun payını düşüren öneri reddedilir; yetersiz örnek önseli korur", () => {
    const groups = new Map([["a", [0.76, 0.8, 0.9, 0.94]]]);
    const narrower: Band = { kind: "twoSided", c: 0.85, h: 0.05, r: 0.1 };
    const check = refitAcceptable(prior, narrower, groups);
    expect(check.ok).toBe(false);
    expect(check.reasons).toContain("narrows_prior_band");
    expect(check.reasons).toContain("lowers_in_band_share:a");
    expect(widenBand(prior, groups).insufficient).toBe(true);
  });
  it("tek taraflı bant yalnız yukarı genişler", () => {
    const one: Band = { kind: "oneSided", h: 0.02, r: 0.04 };
    expect(widenBand(one, new Map([["all", Array.from({ length: 30 }, (_, i) => i * 0.0005)]])).band).toEqual(one);
    const wide = widenBand(one, new Map([["all", Array.from({ length: 30 }, (_, i) => i * 0.001)]]));
    expect(wide.band.kind).toBe("oneSided");
    expect(wide.band.h).toBeGreaterThan(one.h);
    expect(wide.band.r).toBe(one.r);
  });
  it("refitBands: sakallı kayıtta çene ölçüsü ve poz dışı kayıtta genişlik kullanılmaz", () => {
    const bearded = withObs((o) => (o.grooming.facialHair = "full_beard"));
    const items = [
      ...Array.from({ length: 25 }, () => ({ metrics: { jawRatio: 0.6 }, quality: { yaw: 1, pitch: 1 }, votes: bearded, groups: { monk: "a" } })),
      ...Array.from({ length: 25 }, () => ({ metrics: { jawRatio: 0.6 }, quality: { yaw: 10, pitch: 1 }, groups: { monk: "a" } })),
    ];
    const [jaw] = refitBands(items, { jawWidth: { band: prior } });
    expect(jaw.insufficient).toBe(true);
    expect(jaw.suggested).toEqual(prior);
  });
  it("refitCategories: en sık kategori ve IMPUTE önerisi; unclear sayılmaz", () => {
    const votes = [...Array(20).fill(withObs((o) => (o.skin.blemishes = "none"))), ...Array(5).fill(withObs((o) => (o.skin.blemishes = "unclear")))];
    const cfg = {
      ITEM_FIELDS: { blemishes: { sub: "skin", group: "skin", field: "blemishes" } },
      CATEGORY_DELTAS: { blemishes: { none: 1, few: 0, several: -0.8, many: -1.6 } },
      REF_CATEGORY: { blemishes: "few" },
      IMPUTE_DELTA: { blemishes: 0 },
    };
    expect(refitCategories(votes, cfg)).toEqual([{ item: "blemishes", modal: "none", reference: "few", n: 20, suggestedImpute: 1, priorImpute: 0 }]);
  });
});

describe("gizlilik koruması", () => {
  it("landmark dizisi, base64 görsel ve görsel anahtarı reddedilir; sayılar kabul", () => {
    expect(() => assertNumbersOnly({ metrics: { jawRatio: 0.8 }, groups: { monk: "5" } })).not.toThrow();
    expect(() => assertNumbersOnly({ points: Array.from({ length: 478 }, () => 0.5) })).toThrow();
    expect(() => assertNumbersOnly({ x: "/9j/4AAQSkZJRg" })).toThrow();
    expect(() => assertNumbersOnly({ landmarks: [] })).toThrow();
    expect(() => assertNumbersOnly({ imageBase64: "" })).toThrow();
  });
  it("CSV dosya adı, görsel veya serbest metin taşımaz", () => {
    const row: SampleRow = { photo: 0, provider: "claude", sample: 0, ok: true, reason: null, latencyMs: 9000, model: "claude-opus-5-5", usage: { input: 805, output: 600, cacheRead: 1150, cacheWrite5m: 0, cacheWrite1h: 0 }, obs: OBS };
    const csv = samplesCsv([row, { ...row, sample: 1, ok: false, reason: "refusal", obs: null }]);
    const [header, first, second] = csv.trim().split("\n");
    expect(header.split(",")).toContain("skin.blemishes");
    expect(first).toContain("claude-opus-5-5");
    expect(second).toContain("refusal");
    expect(csv).not.toMatch(/\.jpg|\/9j\//);
  });
  it("positional değer alan bayrakları atlar", () => {
    expect(positional(["--repeats", "3", "m.json", "--confirm-paid"], ["--repeats"])).toBe("m.json");
    expect(positional(["--help"], [])).toBeUndefined();
  });
});

describe("compare-observers özeti (sahte motor)", () => {
  it("değişim oranı, κ ve aynı foto payı motor fonksiyonlarıyla hesaplanır", () => {
    const a = OBS;
    const b = withObs((o) => (o.skin.blemishes = "several"));
    const rows: SampleRow[] = [0, 1].flatMap((photo) =>
      (["claude", "gemini"] as const).flatMap((provider) =>
        [0, 1, 2].map((sample) => ({
          photo,
          provider,
          sample,
          ok: true,
          reason: null,
          latencyMs: 1000 * (sample + 1),
          model: provider === "claude" ? "claude-opus-5-5" : "gemini-3.5-flash",
          usage: { input: 1, output: 1, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
          obs: provider === "gemini" && photo === 1 && sample === 2 ? b : a,
        })),
      ),
    );
    const sub = { harmony: 5.5, eyes: 5.5, jawline: 5.5, skin: 5.5, hair: 5.5, grooming: 5.5 };
    const engine = {
      config: { BANDS: {}, CATEGORY_DELTAS: {}, ITEM_FIELDS: {}, REF_CATEGORY: {}, IMPUTE_DELTA: {}, MOD_GAIN: 1, MISSING_PEN: 0 as const },
      aggregateObservations: (s: Observation[]) => ({ final: s[0], agreement: 1 }),
      scoreFromVotes: (_g: unknown, _c: unknown, o: Observation) => ({
        overall: o.skin.blemishes === "several" ? 5.2 : 5.5,
        potential: 6.5,
        rawRounded: sub,
        subscores: sub,
        weights: { harmony: 0.15, eyes: 0.1, jawline: 0.15, skin: 0.2, hair: 0.2, grooming: 0.2 },
        notAssessed: [],
        components: [],
      }),
    };
    const geometry: GeometryResult = {
      version: "geo-v1",
      quality: { yaw: 1, pitch: 1, roll: 0, brightness: 120, sharpness: 80, passed: true },
      metrics: { lengthRatio: 1.3, jawRatio: 0.85, foreheadRatio: 0.9, fwhr: 1.9, canthalTiltDeg: 5, lowerToMiddle: 1.1, thirds: { upper: 0.33, middle: 0.34, lower: 0.33 }, hairlineFound: true },
      faceShape: { primary: "oval", confidence: 0.8 },
      capturedAt: "2026-10-30T00:00:00Z",
    };
    const manifest = {
      dir: "/x",
      items: [0, 1].map(() => ({ file: "f", person: "p1", geometry, context: { headCovering: false, presentation: "male" as const, beardPreference: "any" as const }, labels: [OBS] })),
    };
    const s = summarize(manifest, rows, engine, [1, 2]);
    const gem = s.summaries.find((x) => x.provider === "gemini");
    const cla = s.summaries.find((x) => x.provider === "claude");
    expect(cla?.flip["skin.blemishes"]).toBe(0);
    expect(gem?.flip["skin.blemishes"]).toBe(0.5);
    expect(cla?.samePhoto).toBe(1);
    expect(gem?.samePhoto).toBeCloseTo(4 / 6, 6);
    expect(cla?.fivePhoto).toEqual({ "1": 1, "2": 1 });
    expect(cla?.latencyP50).toBe(2000);
    expect(s.crossKappa["photo.faceCount"]).toBe(1);
  });
});

describe("hybrid.v1 adalet kapısı", () => {
  const row = (groups: Record<string, string>, over: Partial<HybridRow> = {}): HybridRow => ({
    groups,
    overall: 5.5,
    potential: 6.5,
    subscores: { harmony: 5.5, eyes: 5.5, jawline: 5.5, skin: 5.5, hair: 5.5, grooming: 5.5 },
    notAssessed: [],
    components: [{ key: "jawWidth", status: "measured", pen: 0 }],
    obs: OBS,
    capture: { tooDark: false, manual: false, rejected: false },
    ...over,
  });
  it("eşit gruplar geçer", () => {
    const rows = [...Array.from({ length: 5 }, () => row({ monk: "3" })), ...Array.from({ length: 5 }, () => row({ monk: "9" }))];
    const f = engineFairness(rows);
    expect(f.pass).toBe(true);
    expect(f.checks.some((c) => c.gate === "c overall")).toBe(true);
  });
  it("cilt farkı 0,1'i, bant içi pay farkı 10 puanı, too_dark farkı 5 puanı aşarsa kalır", () => {
    const rows = [
      ...Array.from({ length: 5 }, () => row({ monk: "3" })),
      ...Array.from({ length: 5 }, (_, i) =>
        row(
          { monk: "9" },
          {
            subscores: { harmony: 5.5, eyes: 5.5, jawline: 5.5, skin: 5.3, hair: 5.5, grooming: 5.5 },
            components: [{ key: "jawWidth", status: "measured", pen: i === 0 ? 0.3 : 0 }],
            capture: { tooDark: i === 0, manual: false, rejected: false },
          },
        ),
      ),
    ];
    const f = engineFairness(rows);
    expect(f.pass).toBe(false);
    const failed = f.checks.filter((c) => !c.pass).map((c) => c.dimension);
    expect(failed).toContain("monk · skin");
    expect(failed).toContain("monk · jawWidth bant içi %");
    expect(failed).toContain("monk · too_dark %");
  });
  it("değerlendirilmeyen alan o alanın ortalamasına girmez", () => {
    const rows = [
      ...Array.from({ length: 5 }, () => row({ headCovering: "yes" }, { notAssessed: ["hair"], subscores: { harmony: 5.5, eyes: 5.5, jawline: 5.5, skin: 5.5, hair: 0, grooming: 5.5 } })),
      ...Array.from({ length: 5 }, () => row({ headCovering: "no" })),
    ];
    const checks = engineFairness(rows).checks;
    // Saç yalnız "no" grubunda değerlendirildi: karşılaştırılacak ikinci grup yok, sıfır değer ortalamaya girmez.
    expect(checks.find((c) => c.dimension === "headCovering · hair")).toBeUndefined();
    expect(checks.find((c) => c.dimension === "headCovering · skin")?.groups.map((g) => g.name)).toEqual(["no", "yes"]);
  });
});
