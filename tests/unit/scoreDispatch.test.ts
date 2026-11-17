import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScoringProvider } from "@/lib/ai/provider";
import type { ScoreOutput } from "@/lib/ai/scoreSchema";
import { ApiError } from "@/lib/api/errors";
import { classifyFaceShape } from "@/lib/face/faceShape";
import type { GeometryResult } from "@/lib/face/types";
import { ClientSignals } from "@/lib/score/contract";
import { analysisContextFromQuestionnaire, prepareScoring, scoreAnalysis, type AiUsage, type AnalysisContext } from "@/lib/score/service";
import { CTX, FakeProvider, GEO, IMG, REF_OBS, fail, geo, ok } from "../helpers/engineFixtures";

// İz E (engine spec §1.2, §3.6, §9.2): SCORE_ENGINE dağıtımı, reserve öncesi ön kontrol ve satır biçimi. Ağ yok.

const HYBRID = { SCORE_ENGINE: "hybrid.v1", ANTHROPIC_API_KEY: "test-key-not-real" };
const ACTX: AnalysisContext = { ...CTX, bodyFatContextAllowed: false, beardOption: true };

function expectApiError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).code).toBe(code);
    return;
  }
  throw new Error(`beklenen ApiError ${code} fırlatılmadı`);
}

/** Saf legacy sahte sağlayıcı (Gemini sayısal şema biçiminde). */
class FakeScoring implements ScoringProvider {
  readonly model = "gemini-test";
  calls = 0;
  scoreOnce(): Promise<ScoreOutput> {
    this.calls++;
    return Promise.resolve({
      subscores: { harmony: 6, eyes: 6, jawline: 6, skin: 6, hair: 6, grooming: 6 },
      achievableGain: {
        skin: { value: 1, lever: "nemlendirici" },
        hair: { value: 0.5, lever: "kesim" },
        grooming: { value: 0.5, lever: "kaş" },
        jawline: { value: 0.2, lever: "sakal" },
      },
      observations: { skin: "a", hair: "b", brows: "c", facialHair: "d" },
      flags: { visibleSkinConcern: false, skinConcernNote: null, multiplePeopleOrNotAFace: false },
    });
  }
}

describe("prepareScoring (reserve_analysis öncesi)", () => {
  it("SCORE_ENGINE yok/legacy/geçersiz → legacy; geometri aynı nesne, kapı uygulanmaz", () => {
    const bad = geo({ quality: { yaw: 40, brightness: 10 } });
    for (const env of [{}, { SCORE_ENGINE: "legacy" }, { SCORE_ENGINE: "hybrid" }]) {
      const p = prepareScoring(bad, env);
      expect(p.engine).toBe("legacy");
      expect(p.geometry).toBe(bad);
    }
  });

  it("hybrid.v1 + ANTHROPIC_API_KEY yok → açık AI_FAILED (sahte başarı yok)", () => {
    expectApiError(() => prepareScoring(GEO, { SCORE_ENGINE: "hybrid.v1" }), "AI_FAILED");
    expectApiError(() => prepareScoring(GEO, { SCORE_ENGINE: "hybrid.v1", ANTHROPIC_API_KEY: "  " }), "AI_FAILED");
  });

  it("gemini gözlemcisi GEMINI_API_KEY ister", () => {
    expectApiError(() => prepareScoring(GEO, { ...HYBRID, AI_OBSERVE_PROVIDER: "gemini" }), "AI_FAILED");
    expect(prepareScoring(GEO, { SCORE_ENGINE: "hybrid.v1", AI_OBSERVE_PROVIDER: "gemini", GEMINI_API_KEY: "x" }).engine).toBe("hybrid.v1");
  });

  it("üretimde ENGINE_STATUS hazır değilken hybrid.v1 kapalı (engine_not_ready → AI_FAILED)", () => {
    expectApiError(() => prepareScoring(GEO, { ...HYBRID, VERCEL_ENV: "production" }), "AI_FAILED");
    // Önizleme ortamı (staging) açık.
    expect(prepareScoring(GEO, { ...HYBRID, VERCEL_ENV: "preview" }).engine).toBe("hybrid.v1");
  });

  it("sunucu çekim kapısı v2 (KB R1-E12/E14): poz, ışık, bulanıklık reddetmez; yalnız yüz yok → CAPTURE_QUALITY (capture_no_face)", () => {
    expect(prepareScoring(geo({ quality: { yaw: 13 } }), HYBRID).engine).toBe("hybrid.v1");
    expect(prepareScoring(geo({ quality: { pitch: -16 } }), HYBRID).engine).toBe("hybrid.v1");
    expect(prepareScoring(geo({ quality: { brightness: 50 } }), HYBRID).engine).toBe("hybrid.v1");
    expect(prepareScoring(geo({ quality: { sharpness: 30 } }), HYBRID).engine).toBe("hybrid.v1");
    expectApiError(() => prepareScoring(geo({ metrics: { lengthRatio: Number.NaN } }), HYBRID), "CAPTURE_QUALITY");
  });

  it("brightness/sharpness 0 = bilinmiyor → geçer; faceShape sunucuda yeniden hesaplanır, reddedilmez", () => {
    const tampered: GeometryResult = { ...geo({ quality: { brightness: 0, sharpness: 0 } }), faceShape: { primary: "diamond", confidence: 0.99 } };
    const p = prepareScoring(tampered, HYBRID);
    expect(p.engine).toBe("hybrid.v1");
    expect(p.geometry.faceShape).toEqual(classifyFaceShape(tampered.metrics));
    expect(p.geometry.metrics).toEqual(tampered.metrics);
    expect(tampered.faceShape.primary).toBe("diamond"); // girdi değiştirilmez
  });
});

describe("scoreAnalysis dağıtımı", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("OBSERVE_CALLS", "");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("legacy: Gemini sayısal yol değişmedi; motor alanları null, geometri aynen", async () => {
    const sp = new FakeScoring();
    const r = await scoreAnalysis(IMG, GEO, ACTX, { engine: "legacy", scoringProvider: sp });
    expect(sp.calls).toBeGreaterThan(0);
    expect(r.engineVersion).toBeNull();
    expect(r.signals).toBeNull();
    expect(r.aiUsage).toBeNull();
    expect(r.geometry).toBe(GEO);
    expect(r.promptVersion).toBe("score.v1");
    expect(r.observations).toEqual({ skin: "a", hair: "b", brows: "c", facialHair: "d" });
  });

  it("engine verilmezse SCORE_ENGINE okunur (varsayılan legacy)", async () => {
    const sp = new FakeScoring();
    const r = await scoreAnalysis(IMG, GEO, ACTX, { env: {}, scoringProvider: sp, observationProvider: new FakeProvider([ok(REF_OBS)]) });
    expect(r.engineVersion).toBeNull();
    expect(sp.calls).toBeGreaterThan(0);
  });

  it("hybrid.v1: enum gözlemleri + kod skoru; satır sütunları ve signals sözleşmesi", async () => {
    let usage: AiUsage | null = null;
    const provider = new FakeProvider([ok(REF_OBS, 10), ok(REF_OBS, 20), ok(REF_OBS, 30)]);
    const tampered: GeometryResult = { ...GEO, faceShape: { primary: "diamond", confidence: 0.99 } };
    const p = scoreAnalysis(IMG, tampered, ACTX, {
      engine: "hybrid.v1",
      observationProvider: provider,
      onUsage: (u) => {
        usage = u;
      },
    });
    await vi.advanceTimersByTimeAsync(100);
    const r = await p;
    expect(r.engineVersion).toBe("hybrid.v1");
    expect(r.calibrationVersion).toBe("h1");
    expect(r.promptVersion).toBe("observe.v2");
    // Referans profil: her alt skor ve genel 5,5 (UI C10).
    expect(r.overall).toBe(5.5);
    for (const v of Object.values(r.subscores)) expect(v).toBe(5.5);
    expect(ClientSignals.safeParse(r.signals).success).toBe(true);
    expect(Object.keys(r.observations).every((k) => ["skin", "hair", "brows", "facialHair"].includes(k))).toBe(true);
    expect(r.geometry.faceShape).toEqual(classifyFaceShape(GEO.metrics));
    expect(r.aiUsage).not.toBeNull();
    expect(usage).toEqual(r.aiUsage);
    expect(r.model).toBe("claude-opus-5-5");
    // Satıra yazılan hiçbir şeyde görsel veya landmark yok.
    expect(JSON.stringify(r)).not.toMatch(/AAAA|landmarks|"x":/);
  });

  it("hybrid.v1 hatası: onUsage yine çağrılır (rota başarısız satıra ai_usage yazar)", async () => {
    let usage: AiUsage | null = null;
    const p = scoreAnalysis(IMG, GEO, ACTX, {
      engine: "hybrid.v1",
      observationProvider: new FakeProvider([fail("fatal", 5, { status: 400 })]),
      onUsage: (u) => {
        usage = u;
      },
    });
    const settled = p.then(
      () => null,
      (e: unknown) => e,
    );
    await vi.advanceTimersByTimeAsync(100);
    const err = await settled;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe("AI_FAILED");
    expect(usage).not.toBeNull();
  });

  it("hybrid.v1 doğrudan çağrıda da çekim kapısı uygulanır (yüz yok)", async () => {
    await expect(scoreAnalysis(IMG, geo({ metrics: { jawRatio: Number.NaN } }), ACTX, { engine: "hybrid.v1", observationProvider: new FakeProvider([ok(REF_OBS)]) })).rejects.toMatchObject({
      code: "CAPTURE_QUALITY",
    });
  });
});

describe("analysisContextFromQuestionnaire", () => {
  it("anket yok/bozuk → temkinli varsayılanlar", () => {
    expect(analysisContextFromQuestionnaire(null)).toEqual({
      presentation: "unspecified",
      bodyFatContextAllowed: false,
      beardOption: false,
      headCovering: false,
      beardPreference: "none",
    });
  });

  it("anketten legacy ve motor bağlamı", () => {
    const q = {
      goals: ["skin"],
      presentation: "female",
      hairType: "curly",
      hairLength: "long",
      beardPreference: "none",
      beardGrowth: "sparse",
      skinType: "dry",
      budget: "low",
      minutesPerDay: 10,
      glasses: false,
      headCovering: true,
      body: { heightCm: 165, weightKg: 75, activity: "low" },
      jawHealth: [],
    };
    expect(analysisContextFromQuestionnaire(q)).toEqual({
      presentation: "female",
      bodyFatContextAllowed: true,
      beardOption: false,
      headCovering: true,
      beardPreference: "none",
    });
  });
});
