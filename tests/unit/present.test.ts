import { describe, expect, it } from "vitest";
import { afterEach, vi } from "vitest";
import { SUB_KIND, SUB_KIND_HYBRID } from "@/lib/config/scoring";
import { SUB_KEYS, TEASER_MODES, type SubKey } from "@/lib/config/teaser";
import type { ClientSignals } from "@/lib/score/contract";
import { toClientAnalysis, toClientSummary, type AnalysisRow } from "@/lib/score/present";

const row: AnalysisRow = {
  id: "a1",
  status: "completed",
  created_at: "2026-10-09T10:00:00Z",
  face_shape: "oval",
  overall: 6.4,
  potential: 7.6,
  subscores: { harmony: 6.1, eyes: 6.0, jawline: 6.3, skin: 5.9, hair: 6.8, grooming: 6.2 },
  gains: {},
  observations: { skin: "alında parlama" },
  geometry: {
    version: "geo-v1",
    quality: { yaw: 1, pitch: 2, roll: 0, brightness: 120, sharpness: 90, passed: true },
    metrics: { lengthRatio: 1.4, jawRatio: 0.84, foreheadRatio: 0.9, fwhr: 1.9, canthalTiltDeg: 3, lowerToMiddle: 1.2, thirds: { upper: 0.3, middle: 0.33, lower: 0.37 }, hairlineFound: true },
    faceShape: { primary: "oval", confidence: 0.8 },
    capturedAt: "2026-10-09T10:00:00Z",
  },
  calibration_version: "v0",
};

describe("toClientAnalysis (SPEC 14.1 / 5.3)", () => {
  it("shape_plus_one: yüz şekli + bir alt skor açık; genel, potansiyel, diğer alt skorlar, oranlar, gözlemler kilitli ve JSON'da yok", () => {
    const c = toClientAnalysis(row, false, "shape_plus_one", "skin");
    expect(c.faceShape).toBe("oval");
    expect(c.subscores.skin).toEqual({ value: 5.9, locked: false });
    expect(c.subscores.hair).toEqual({ value: null, locked: true });
    expect(c.overall).toEqual({ value: null, locked: true });
    expect(c.potential).toEqual({ value: null, locked: true });
    expect(c.metrics.locked).toBe(true);
    expect(c.observations.locked).toBe(true);
    const json = JSON.stringify(c);
    expect(json).not.toContain("6.4");
    expect(json).not.toContain("7.6");
    expect(json).not.toContain("6.8");
    expect(json).not.toContain("parlama");
    expect(json).not.toContain("lengthRatio");
  });
  it("overall_only: genel skor açık, potansiyel ve alt skorlar kilitli", () => {
    const c = toClientAnalysis(row, false, "overall_only", "skin");
    expect(c.overall).toEqual({ value: 6.4, locked: false });
    expect(c.potential.locked).toBe(true);
    expect(c.subscores.skin.locked).toBe(true);
  });
  it("shape_only: yalnız yüz şekli", () => {
    const c = toClientAnalysis(row, false, "shape_only", "skin");
    expect(c.overall.locked).toBe(true);
    // v1 satırda brows yoktur: { null, locked:false } (değerlendirilmedi); v1 altılısı kilitli
    for (const k of SUB_KEYS) expect(c.subscores[k].locked).toBe(true);
    expect(c.subscores.brows).toEqual({ value: null, locked: false });
    expect(c.faceShape).toBe("oval");
  });
  it("premium: her şey açık", () => {
    const c = toClientAnalysis(row, true, "shape_plus_one", "skin");
    expect(c.overall).toEqual({ value: 6.4, locked: false });
    expect(c.potential).toEqual({ value: 7.6, locked: false });
    expect(c.subscores.hair).toEqual({ value: 6.8, locked: false });
    expect(c.metrics.locked).toBe(false);
  });
  it("özet listede ücretsiz kullanıcıya skor gitmez", () => {
    expect(toClientSummary(row, false).overall).toBeNull();
    expect(toClientSummary(row, true).overall).toBe(6.4);
  });
});

// ---- hybrid.v1 eklemeleri ve kilit kuralları (UI spec §1.2, engine spec §8) ----

const signals: ClientSignals & Record<string, unknown> = {
  engine: "hybrid.v1",
  improveFirst: [
    { sub: "skin", lever: "lv_blemish_care", gain: 0.3 },
    { sub: "hair", lever: "lv_hair_styling", gain: 0.2 },
    { sub: "grooming", lever: "lv_lip_care", gain: 0.2 },
  ],
  explain: {
    harmony: [{ key: "symmetry", status: "measured" }, { key: "vertical", status: "not_measured" }],
    eyes: [{ key: "spacing", status: "measured" }, { key: "tilt", status: "measured" }],
    jawline: [{ key: "jawWidth", status: "measured" }],
    skin: [{ key: "blemishes", status: "partial" }, { key: "texture", status: "best" }],
    hair: [{ key: "hairNeat", status: "partial" }, { key: "hairShape", status: "best" }],
    grooming: [{ key: "brows", status: "best" }, { key: "lips", status: "partial" }],
  },
  notAssessed: [],
  captureHints: ["lighting", "pose"],
  // SignalsV1'in sunucuda kalan kısmı: istemciye asla gitmez.
  v: 1,
  obs: { skin: { blemishes: "few" } },
  weights: { harmony: 0.15 },
  raw: { skin: 5.3 },
  gains: { skin: 0.73 },
};

const hybrid = (sig: unknown = signals, over: Partial<AnalysisRow> = {}): AnalysisRow => ({
  ...row,
  overall: 5.43,
  potential: 6.21,
  subscores: { harmony: 5.4, eyes: 5.2, jawline: 5.1, skin: 5.3, hair: 6.7, grooming: 5.9 },
  observations: { skin: "Yanaklarda birkaç küçük aktif sivilce var.", brows: "Kaşlar düzenli." },
  calibration_version: "h1",
  prompt_version: "observe.v1",
  engine_version: "hybrid.v1",
  signals: sig,
  ...over,
});
const withSignals = (patch: Partial<ClientSignals>) => hybrid({ ...signals, ...patch });

/** Ücretsiz JSON'da asla bulunmaması gerekenler (kaldıraç, açık delta, öncelik listesi, kilitli açıklama öğeleri). */
const FREE_LEAK = /lv_|"potentialDelta":\{"value":\d|"improveFirst":\{"value":\[|hairNeat|"key":"brows"|symmetry/;

describe("toClientAnalysis hybrid.v1: alanlar", () => {
  it("motor ve rozetler açık: hybrid'de çene hattı yapısal, eski satırda kısmen", () => {
    const h = toClientAnalysis(hybrid(), false, "shape_only", "skin");
    expect(h.engine).toBe("hybrid.v1");
    expect(h.kinds).toEqual(SUB_KIND_HYBRID);
    expect(h.kinds.jawline).toBe("structural");
    const l = toClientAnalysis(row, false, "shape_only", "skin");
    expect(l.engine).toBe("legacy");
    expect(l.kinds).toEqual(SUB_KIND);
    expect(l.kinds.jawline).toBe("partial");
    expect(toClientAnalysis(hybrid(signals, { engine_version: "hybrid.v2" }), true, "shape_only", "skin").engine).toBe("hybrid.v2");
    expect(toClientAnalysis(hybrid(signals, { engine_version: "hybrid.v3" }), true, "shape_only", "skin").engine).toBe("legacy");
  });

  it("premium: her şey açık; potentialDelta = round1(potential − overall)", () => {
    const c = toClientAnalysis(hybrid(), true, "shape_plus_one", "skin");
    expect(c.potentialDelta).toEqual({ value: 0.8, locked: false });
    expect(c.improveFirst).toEqual({ value: signals.improveFirst, locked: false });
    for (const k of SUB_KEYS) {
      expect(c.subscores[k].locked).toBe(false);
      expect(c.explain[k]).toEqual({ value: signals.explain[k], locked: false });
    }
    expect(c.captureHints).toEqual(["lighting", "pose"]);
  });

  it("premium: değerlendirilmeyen alt skorun kaldıracı öncelik listesinde gösterilmez", () => {
    const sig = withSignals({ notAssessed: [{ sub: "hair", reason: "excluded" }] });
    const c = toClientAnalysis(sig, true, "shape_plus_one", "skin");
    expect(c.improveFirst.value?.map((i) => i.lever)).toEqual(["lv_blemish_care", "lv_lip_care"]);
  });

  it("potentialDelta asla negatif değil", () => {
    expect(toClientAnalysis(hybrid(signals, { overall: 6.6, potential: 6.6 }), true, "shape_only", "skin").potentialDelta).toEqual({ value: 0, locked: false });
    expect(toClientAnalysis(hybrid(signals, { overall: 6.6, potential: 6.4 }), true, "shape_only", "skin").potentialDelta).toEqual({ value: 0, locked: false });
    expect(toClientAnalysis(hybrid(signals, { potential: null }), true, "shape_only", "skin").potentialDelta).toEqual({ value: null, locked: false });
  });

  it("SignalsV1'in sunucu kısmı (obs, weights, raw, gains) hiçbir görünümde istemciye gitmez", () => {
    for (const premium of [true, false]) {
      for (const mode of TEASER_MODES) {
        const json = JSON.stringify(toClientAnalysis(hybrid(), premium, mode, "skin"));
        expect(json).not.toMatch(/"signals"|"weights"|"raw"|"obs"|"gains"|0\.73|"v":1/);
      }
    }
  });
});

describe("toClientAnalysis hybrid.v1: kilitler (ücretsiz)", () => {
  it("shape_plus_one/skin: yalnız cilt açıklaması açık; kaldıraç, delta, öncelik listesi JSON'da yok", () => {
    const c = toClientAnalysis(hybrid(), false, "shape_plus_one", "skin");
    expect(c.explain.skin).toEqual({ value: signals.explain.skin, locked: false });
    expect(c.explain.hair).toEqual({ value: null, locked: true });
    for (const k of SUB_KEYS.filter((s) => s !== "skin")) expect(c.explain[k]).toEqual({ value: null, locked: true });
    expect(c.potentialDelta).toEqual({ value: null, locked: true });
    expect(c.improveFirst).toEqual({ value: null, locked: true });
    const json = JSON.stringify(c);
    expect(json).not.toMatch(FREE_LEAK);
    // kilitli sayılar (genel, potansiyel, delta, diğer alt skorlar, öncelik kazançları) yok
    for (const n of ["5.43", "6.21", "6.7", "5.9"]) expect(json).not.toContain(n);
    for (const n of ["0.8", "0.3", "0.2"]) expect(json).not.toMatch(new RegExp(`"(value|gain)":${n.replace(".", "\\.")}`));
  });

  it("shape_plus_one/skin + fotoğraf kaynaklı görünmeyen saç: notAssessed'te hair yok, saç kilitli", () => {
    const c = toClientAnalysis(withSignals({ notAssessed: [{ sub: "hair", reason: "not_visible" }] }), false, "shape_plus_one", "skin");
    expect(c.notAssessed).toEqual([]);
    expect(c.subscores.hair).toEqual({ value: null, locked: true });
    expect(c.explain.hair).toEqual({ value: null, locked: true });
    expect(JSON.stringify(c)).not.toContain("not_visible");
  });

  it("shape_plus_one/skin + açık cilt görünmüyor: notAssessed'te skin listelenir (değer zaten açık)", () => {
    const c = toClientAnalysis(withSignals({ notAssessed: [{ sub: "skin", reason: "not_visible" }] }), false, "shape_plus_one", "skin");
    expect(c.notAssessed).toEqual([{ sub: "skin", reason: "not_visible" }]);
    expect(c.subscores.skin).toEqual({ value: 5.3, locked: false });
  });

  it("beyan edilen başörtüsü (excluded): herkese açık, değer yok, kilit yok", () => {
    const { hair: _hair, ...explainNoHair } = signals.explain;
    void _hair;
    const sig = withSignals({ notAssessed: [{ sub: "hair", reason: "excluded" }], explain: explainNoHair });
    for (const mode of TEASER_MODES) {
      const c = toClientAnalysis(sig, false, mode, "skin");
      expect(c.notAssessed).toContainEqual({ sub: "hair", reason: "excluded" });
      expect(c.subscores.hair).toEqual({ value: null, locked: false });
      expect(c.explain.hair).toEqual({ value: null, locked: false });
    }
    // premium da aynı: hariç tutulan alt skorun saklanan referans değeri (6.7 burada) asla gitmez
    const p = toClientAnalysis(sig, true, "shape_plus_one", "skin");
    expect(p.subscores.hair).toEqual({ value: null, locked: false });
    expect(JSON.stringify(p.subscores)).not.toContain("6.7");
  });

  it("teaser alt skoru hariç tutulmuşsa bile kilit açılmaz, yalnız boş değer gelir", () => {
    const sig = withSignals({ notAssessed: [{ sub: "hair", reason: "excluded" }] });
    const c = toClientAnalysis(sig, false, "shape_plus_one", "hair");
    expect(c.subscores.hair).toEqual({ value: null, locked: false });
    expect(c.subscores.skin).toEqual({ value: null, locked: true });
  });

  it("overall_only + kapalı cilt: tüm açıklamalar kilitli; skin notAssessed ve cilt ipuçları yok", () => {
    const sig = withSignals({ notAssessed: [{ sub: "skin", reason: "not_visible" }], captureHints: ["lighting", "pose", "skin_visibility", "retouch"] });
    const c = toClientAnalysis(sig, false, "overall_only", "skin");
    for (const k of SUB_KEYS) expect(c.explain[k]).toEqual({ value: null, locked: true });
    expect(c.notAssessed).toEqual([]);
    expect(c.captureHints).toEqual(["lighting", "pose"]);
    expect(c.overall).toEqual({ value: 5.43, locked: false });
    expect(c.potentialDelta).toEqual({ value: null, locked: true });
  });

  it("shape_only: hariç tutulan alt skor dışında her şey kilitli", () => {
    const sig = withSignals({
      notAssessed: [
        { sub: "hair", reason: "excluded" },
        { sub: "skin", reason: "not_visible" },
      ],
      captureHints: ["pose", "retouch"],
    });
    const c = toClientAnalysis(sig, false, "shape_only", "skin");
    for (const k of SUB_KEYS) {
      if (k === "hair") expect(c.subscores[k]).toEqual({ value: null, locked: false });
      else expect(c.subscores[k]).toEqual({ value: null, locked: true });
      expect(c.explain[k].value).toBeNull();
    }
    expect(c.notAssessed).toEqual([{ sub: "hair", reason: "excluded" }]);
    expect(c.captureHints).toEqual(["pose"]);
    expect(JSON.stringify(c)).not.toMatch(FREE_LEAK);
  });

  it("kilitli her alanda değer null (tüm modlar, tüm teaser alt skorları)", () => {
    const sig = withSignals({ notAssessed: [{ sub: "skin", reason: "not_visible" }, { sub: "hair", reason: "not_visible" }] });
    for (const mode of TEASER_MODES) {
      for (const teaser of SUB_KEYS as readonly SubKey[]) {
        const c = toClientAnalysis(sig, false, mode, teaser);
        const all = [c.overall, c.potential, c.potentialDelta, c.improveFirst, c.metrics, c.observations, ...Object.values(c.subscores), ...Object.values(c.explain)];
        for (const l of all) if (l.locked) expect(l.value).toBeNull();
        for (const n of c.notAssessed) expect(c.subscores[n.sub].locked).toBe(false);
        if (c.subscores.skin.locked) expect(c.captureHints.filter((h) => h === "skin_visibility" || h === "retouch")).toEqual([]);
        expect(JSON.stringify(c)).not.toMatch(/lv_|"potentialDelta":\{"value":\d|"improveFirst":\{"value":\[/);
      }
    }
  });
});

describe("toClientAnalysis: eski satır ve bozuk signals", () => {
  afterEach(() => vi.restoreAllMocks());

  it("eski satır (engine_version yok): açık null'lar, boş listeler, delta sütunlardan", () => {
    const c = toClientAnalysis(row, true, "shape_plus_one", "skin");
    expect(c.engine).toBe("legacy");
    expect(c.improveFirst).toEqual({ value: null, locked: false });
    for (const k of SUB_KEYS) expect(c.explain[k]).toEqual({ value: null, locked: false });
    expect(c.notAssessed).toEqual([]);
    expect(c.captureHints).toEqual([]);
    expect(c.potentialDelta).toEqual({ value: 1.2, locked: false });
    expect(toClientAnalysis(row, false, "shape_plus_one", "skin").potentialDelta).toEqual({ value: null, locked: true });
  });

  it("eski satırdaki signals sütunu yok sayılır", () => {
    const c = toClientAnalysis({ ...row, engine_version: null, signals }, true, "shape_plus_one", "skin");
    expect(c.improveFirst).toEqual({ value: null, locked: false });
    expect(c.notAssessed).toEqual([]);
  });

  it("hybrid satır + geçersiz signals: skorlar korunur, türetilmiş alanlar varsayılana düşer, içerik loglanmaz", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = hybrid({ ...signals, improveFirst: [{ sub: "skin", lever: "lv_unknown", gain: 0.3 }] });
    const c = toClientAnalysis(bad, true, "shape_plus_one", "skin");
    expect(c.engine).toBe("hybrid.v1");
    expect(c.kinds.jawline).toBe("structural");
    expect(c.overall).toEqual({ value: 5.43, locked: false });
    expect(c.subscores.hair).toEqual({ value: 6.7, locked: false });
    expect(c.improveFirst).toEqual({ value: null, locked: false });
    for (const k of SUB_KEYS) expect(c.explain[k]).toEqual({ value: null, locked: false });
    expect(c.notAssessed).toEqual([]);
    expect(c.captureHints).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("signals_parse_failed");
    expect(String(warn.mock.calls[0]?.[0])).not.toContain("lv_unknown");
    expect(toClientAnalysis(hybrid(null), false, "shape_only", "skin").improveFirst).toEqual({ value: null, locked: false });
  });

  it("özet: motor adı açık, skorlar ücretsizde null", () => {
    expect(toClientSummary(hybrid(), false)).toMatchObject({ engine: "hybrid.v1", overall: null, potential: null });
    expect(toClientSummary(row, true).engine).toBe("legacy");
  });
});
