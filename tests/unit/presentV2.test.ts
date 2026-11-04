import { describe, expect, it } from "vitest";
import { SUB_KEYS_V2 } from "@/lib/config/teaser";
import type { ClientSignalsV2, ReportV3 } from "@/lib/score/contract";
import { deviceResultFromGeometry, stageOf, toClientAnalysisV2, type AccessV2, type AnalysisRowV2 } from "@/lib/score/present";

const geometry = {
  version: "geo-v1" as const,
  quality: { yaw: 1, pitch: 2, roll: 0, brightness: 120, sharpness: 90, passed: true },
  metrics: { lengthRatio: 1.4, jawRatio: 0.84, foreheadRatio: 0.9, fwhr: 1.9, canthalTiltDeg: 3, lowerToMiddle: 1.2, thirds: { upper: 0.3, middle: 0.33, lower: 0.37 }, hairlineFound: true },
  faceShape: { primary: "oval" as const, secondary: "long" as const, confidence: 0.6 },
  capturedAt: "2026-11-04T10:00:00Z",
};

const explanation = { lookedAt: ["Alın ve yanak dokusu"], held: ["Düzenli doku"], lowered: ["T bölgesinde parlama"], raise: [{ step: "Matlaştırıcı nemlendirici", effect: "+0,3" }], confidenceNote: "3 açı, iyi ışık" };
const signals: ClientSignalsV2 = {
  engine: "hybrid.v2",
  explanations: Object.fromEntries(SUB_KEYS_V2.map((k) => [k, explanation])),
  improveFirst: [
    { sub: "skin", stepId: "st_spf", step: "Günlük SPF", gain: 0.3 },
    { sub: "hair", stepId: "st_cut", step: "Kesim yenile", gain: 0.2 },
    { sub: "brows", stepId: "st_brow", step: "Kaş düzeni", gain: 0.1 },
  ],
  notAssessed: [],
  faceShapeDetailed: { shape: "square", secondary: "oval", reason: "Yan profilde çene köşeleri belirgin." },
  captureHints: ["lighting"],
  viewsUsed: ["front", "profile_left", "left45"],
};
const report: ReportV3 = {
  version: "report.v3",
  letter: "En güçlü yanın cilt dokun; en büyük fırsat saç şekli.",
  regions: [{ key: "skin", strength: "Düzenli doku", seen: "Alında hafif parlama", improvements: ["Matlaştırıcı"] }],
  measures: [{ key: "jawRatio", value: 0.84, balancedRange: [0.75, 0.95] }],
  closing: "Değişim haftalar sürer. Tıbbi tavsiye değildir.",
};
const subs = { harmony: 5.4, eyes: 5.9, jawline: 5.1, skin: 6.3, hair: 6.7, grooming: 5.9, brows: 5.5 };
const ranges = Object.fromEntries(SUB_KEYS_V2.map((k) => [k, [subs[k] - 0.2, subs[k] + 0.2]]));

const completed: AnalysisRowV2 = {
  id: "a2",
  status: "completed",
  created_at: "2026-11-04T10:00:00Z",
  face_shape: "oval",
  overall: 5.8,
  potential: 6.9,
  subscores: subs,
  gains: null,
  observations: null,
  geometry,
  calibration_version: "h2",
  engine_version: "hybrid.v2",
  signals,
  device_result: deviceResultFromGeometry(geometry),
  score_range: { overall: [5.6, 6.0], potential: [6.6, 7.2], subscores: ranges },
  percentile: "61.5",
  sections_ready: ["device", "overall", "subscores", "potential", "faceShape", "explanations", "improveFirst", "report"],
  set_key: "abc",
  report,
  runs: [[5.4, 5.9], [5.5, 5.8]],
} as AnalysisRowV2 & { runs: unknown };

const deviceOnly: AnalysisRowV2 = { ...completed, status: "device_only", overall: null, potential: null, subscores: null, signals: null, score_range: null, percentile: null, sections_ready: [], report: undefined };

const NONE: AccessV2 = { entitled: false, referralUnlock: false, percentile: false };
const PAID: AccessV2 = { entitled: true, referralUnlock: false, percentile: false };
const REF: AccessV2 = { entitled: false, referralUnlock: true, percentile: true };

/** Ödeme öncesi JSON'da asla görünmemesi gerekenler. */
const LEAK = /5\.8|6\.9|6\.7|6\.3|61\.5|"range":\[|parlama|st_spf|square|Yan profilde|runs|set_key|abc/;

describe("toClientAnalysisV2: device_only (ödeme öncesi)", () => {
  it("yalnız cihaz alanları açık; skor, alt skor, potansiyel, açıklama, rapor, öncelik kilitli yer tutucu", () => {
    const c = toClientAnalysisV2(deviceOnly, NONE);
    expect(c.stage).toBe("device_only");
    expect(c.device).toEqual({ ratios: { canthalTiltDeg: 3, jawRatio: 0.84, fwhr: 1.9, thirds: { upper: 0.3, middle: 0.33, lower: 0.37 } }, faceShapePrelim: geometry.faceShape });
    expect(c.faceShape).toEqual({ prelim: geometry.faceShape, agree: null });
    expect(c.overall).toEqual({ value: null, locked: true });
    expect(c.potential).toEqual({ value: null, locked: true });
    expect(c.report).toEqual({ value: null, locked: true });
    expect(c.improveFirst).toEqual({ value: null, locked: true });
    for (const k of SUB_KEYS_V2) {
      expect(c.subscores[k]).toEqual({ value: null, locked: true });
      expect(c.explanations[k]).toEqual({ value: null, locked: true });
    }
    expect(c.sectionsReady).toEqual(["device"]);
    expect(c.noiseBand).toBe(0.3);
    expect(JSON.stringify(c)).not.toMatch(LEAK);
  });

  it("tamamlanmış satır + hak yok: cihaz hariç her şey kilitli; gerçek değer JSON'da yok", () => {
    const c = toClientAnalysisV2(completed, NONE);
    expect(c.stage).toBe("completed");
    expect(c.overall).toEqual({ value: null, locked: true });
    expect(c.faceShape).toEqual({ prelim: geometry.faceShape, agree: null });
    expect(c.sectionsReady).toEqual(["device"]);
    expect(c.notAssessed).toEqual([]);
    expect(JSON.stringify(c)).not.toMatch(LEAK);
  });

  it("queued/running/failed: skorlar kilitli; processing → running; failed → failure (hak düşmez, yeniden denenebilir)", () => {
    expect(stageOf("processing")).toBe("running");
    const q = toClientAnalysisV2({ ...completed, status: "queued" }, PAID);
    expect(q.stage).toBe("queued");
    expect(q.overall).toEqual({ value: null, locked: true });
    const f = toClientAnalysisV2({ ...completed, status: "failed" }, PAID);
    expect(f.failure).toEqual({ code: "AI_FAILED", retryable: true });
    expect(JSON.stringify(f)).not.toMatch(LEAK);
  });
});

describe("toClientAnalysisV2: ödeme sonrası (entitled)", () => {
  it("her şey açık: değer + aralık; yüzdelik bayrak kapalıyken null; potansiyel delta = +1,1", () => {
    const c = toClientAnalysisV2(completed, PAID);
    expect(c.overall).toEqual({ value: { value: 5.8, range: [5.6, 6.0], percentile: null }, locked: false });
    expect(c.potential).toEqual({ value: { value: 6.9, range: [6.6, 7.2], delta: 1.1 }, locked: false });
    expect(c.subscores.brows).toEqual({ value: { value: 5.5, range: [5.3, 5.7] }, locked: false });
    expect(c.explanations.skin).toEqual({ value: explanation, locked: false });
    expect(c.report).toEqual({ value: report, locked: false });
    expect(c.improveFirst.value?.map((i) => i.stepId)).toEqual(["st_spf", "st_cut", "st_brow"]);
    expect(c.faceShape).toEqual({ prelim: geometry.faceShape, detailed: signals.faceShapeDetailed, agree: false });
    expect(c.sectionsReady).toHaveLength(8);
    expect(c.viewsUsed).toBe(3);
  });

  it("running + hak (kart kart açılış, KB P#23): yalnız sections_ready'deki bölümler açık; kalanı açık-null; hak yoksa kilitli", () => {
    const running: AnalysisRowV2 = { ...completed, status: "running", report: undefined, sections_ready: ["device", "overall", "subscores"] };
    const c = toClientAnalysisV2(running, PAID);
    expect(c.stage).toBe("running");
    expect(c.overall).toEqual({ value: { value: 5.8, range: [5.6, 6.0], percentile: null }, locked: false });
    expect(c.subscores.skin).toEqual({ value: { value: 6.3, range: [6.1, 6.5] }, locked: false });
    expect(c.potential).toEqual({ value: null, locked: false });
    expect(c.explanations.skin).toEqual({ value: null, locked: false });
    expect(c.report).toEqual({ value: null, locked: false });
    expect(c.improveFirst).toEqual({ value: null, locked: false });
    expect(c.faceShape?.detailed).toBeUndefined();
    expect(c.sectionsReady).toEqual(["device", "overall", "subscores"]);
    // Hak yokken running satırı tamamen kilitli; sectionsReady yalnız cihaz.
    const locked = toClientAnalysisV2(running, NONE);
    expect(locked.overall).toEqual({ value: null, locked: true });
    expect(locked.subscores.skin).toEqual({ value: null, locked: true });
    expect(locked.sectionsReady).toEqual(["device"]);
    expect(JSON.stringify(locked)).not.toMatch(LEAK);
  });

  it("FEATURE_PERCENTILE açık: yalnız genel skorda yüzdelik (numeric metin sayıya çevrilir)", () => {
    const c = toClientAnalysisV2(completed, { ...PAID, percentile: true });
    expect(c.overall.value?.percentile).toBe(61.5);
    expect(JSON.stringify(c.subscores)).not.toContain("percentile");
  });

  it("hazır olmayan bölüm: { null, locked:false }; aralığı olmayan alt skor da açık-null (yarım değer gitmez)", () => {
    const c = toClientAnalysisV2({ ...completed, report: undefined, score_range: { overall: [5.6, 6.0] }, sections_ready: ["device", "overall"] }, PAID);
    expect(c.report).toEqual({ value: null, locked: false });
    expect(c.potential).toEqual({ value: null, locked: false });
    expect(c.subscores.skin).toEqual({ value: null, locked: false });
    expect(c.sectionsReady).toEqual(["device", "overall"]);
  });

  it("yüz şekli: detaylı ön değerlendirmeyle aynıysa agree true; override geçer; sessiz değişiklik yok", () => {
    const same = { ...completed, signals: { ...signals, faceShapeDetailed: { shape: "oval", reason: "Uyumlu." } }, face_shape_override: "round" };
    const c = toClientAnalysisV2(same, PAID);
    expect(c.faceShape?.agree).toBe(true);
    expect(c.faceShape?.prelim.primary).toBe("oval");
    expect(c.faceShape?.override).toBe("round");
    expect(toClientAnalysisV2({ ...completed, face_shape_override: "weird" }, PAID).faceShape?.override).toBeUndefined();
  });

  it("hariç tutulan alt skor (excluded) herkese { null, locked:false }; öncelik listesinden düşer; not_visible yalnız açıkta", () => {
    const sig: ClientSignalsV2 = { ...signals, notAssessed: [{ sub: "hair", reason: "excluded" }, { sub: "skin", reason: "not_visible" }] };
    const paid = toClientAnalysisV2({ ...completed, signals: sig }, PAID);
    expect(paid.subscores.hair).toEqual({ value: null, locked: false });
    expect(paid.explanations.hair).toEqual({ value: null, locked: false });
    expect(paid.improveFirst.value?.map((i) => i.sub)).toEqual(["skin", "brows"]);
    expect(paid.notAssessed).toHaveLength(2);
    const free = toClientAnalysisV2({ ...completed, signals: sig }, NONE);
    expect(free.subscores.hair).toEqual({ value: null, locked: false });
    expect(free.subscores.skin).toEqual({ value: null, locked: true });
    expect(free.notAssessed).toEqual([{ sub: "hair", reason: "excluded" }]);
    expect(JSON.stringify(free)).not.toContain("not_visible");
  });

  it("sunucu alanları (runs, set_key, signals'ın kendisi) hiçbir görünümde gitmez", () => {
    for (const access of [NONE, PAID, REF]) expect(JSON.stringify(toClientAnalysisV2(completed, access))).not.toMatch(/"runs"|set_key|"signals"|"abc"/);
  });
});

describe("toClientAnalysisV2: davet kilidi (referralUnlock, Ç12)", () => {
  it("yalnız genel skor değeri açık; aralık ve yüzdelik null; potansiyel, alt skorlar, açıklama, rapor kilitli", () => {
    const c = toClientAnalysisV2(completed, REF);
    expect(c.overall).toEqual({ value: { value: 5.8, range: null, percentile: null }, locked: false });
    expect(c.potential).toEqual({ value: null, locked: true });
    expect(c.report).toEqual({ value: null, locked: true });
    expect(c.improveFirst).toEqual({ value: null, locked: true });
    for (const k of SUB_KEYS_V2) expect(c.subscores[k]).toEqual({ value: null, locked: true });
    expect(c.faceShape?.detailed).toBeUndefined();
    const json = JSON.stringify(c);
    expect(json).not.toMatch(/6\.9|6\.7|61\.5|"range":\[|st_spf|square/);
  });
  it("davet kilidi tamamlanmamış analizde skor açmaz", () => {
    expect(toClientAnalysisV2(deviceOnly, REF).overall).toEqual({ value: null, locked: true });
  });
});
