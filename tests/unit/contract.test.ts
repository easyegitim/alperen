import { describe, expect, it } from "vitest";
import {
  CALIBRATION_REFERENCE,
  CALIBRATION_V0,
  SUB_KIND,
  SUB_KIND_HYBRID,
  getScoreEngine,
  scoreEngineBlocked,
  type EngineReadiness,
} from "@/lib/config/scoring";
import { SUB_KEYS } from "@/lib/config/teaser";
import * as contract from "@/lib/score/contract";
import {
  BEARD_LEVERS,
  CAPTURE_HINTS,
  ClientSignals,
  LEVER_KEYS,
  LEVER_SUB,
  MOD_EXPLAIN_KEYS,
  MOD_SUBS,
  NOT_ASSESSED_REASONS,
  STRUCTURAL_EXPLAIN_KEYS,
} from "@/lib/score/contract";
import { ANALYSIS_ROW_COLUMNS } from "@/lib/score/rowColumns";
import { bindSessionSelfie, getSessionSelfie, setSessionSelfie, type SessionSelfie } from "@/lib/face/sessionStore";

const full: ClientSignals = {
  engine: "hybrid.v1",
  improveFirst: [
    { sub: "skin", lever: "lv_texture_smooth", gain: 0.3 },
    { sub: "hair", lever: "lv_haircut_refresh", gain: 0.2 },
    { sub: "grooming", lever: "lv_beard_lineup", gain: 0.1 },
  ],
  explain: {
    harmony: STRUCTURAL_EXPLAIN_KEYS.slice(0, 2).map((key) => ({ key, status: "measured" as const })),
    eyes: [{ key: "eyeMouth", status: "not_measured" }, { key: "spacing", status: "measured" }, { key: "tilt", status: "measured" }],
    jawline: [{ key: "jawWidth", status: "not_measured" }],
    skin: [{ key: "blemishes", status: "best" }, { key: "texture", status: "partial" }, { key: "shine", status: "unclear" }],
    hair: [{ key: "hairNeat", status: "best" }, { key: "hairShape", status: "partial" }],
    grooming: [{ key: "brows", status: "unclear" }, { key: "lips", status: "best" }, { key: "facialHairEdges", status: "partial" }],
  },
  notAssessed: NOT_ASSESSED_REASONS.map((reason, i) => ({ sub: MOD_SUBS[i]!, reason })),
  captureHints: [...CAPTURE_HINTS],
};

describe("ClientSignals (sözleşme C5)", () => {
  it("her neden, ipucu ve durumu içeren el yazımı örneği kabul eder", () => {
    expect(ClientSignals.parse(full)).toEqual(full);
  });

  it("bilinmeyen anahtarları atar (SignalsV1'in sunucu kısmı istemci tipine taşınmaz)", () => {
    const parsed = ClientSignals.parse({ ...full, v: 1, obs: { hair: { visibility: "visible" } }, weights: { skin: 0.2 } });
    expect(Object.keys(parsed).sort()).toEqual(["captureHints", "engine", "explain", "improveFirst", "notAssessed"]);
  });

  it("bilinmeyen kaldıraç, ipucu, neden ve durumları reddeder", () => {
    const bad: unknown[] = [
      { ...full, engine: "legacy" },
      { ...full, improveFirst: [{ sub: "skin", lever: "lv_unknown", gain: 0.2 }] },
      { ...full, improveFirst: [{ sub: "skin", lever: "lv_blemish_care", gain: 0 }] },
      { ...full, improveFirst: [{ sub: "harmony", lever: "lv_blemish_care", gain: 0.2 }] },
      { ...full, improveFirst: [...full.improveFirst, { sub: "skin", lever: "lv_shine_balance", gain: 0.1 }] },
      { ...full, captureHints: ["hair_covered"] },
      { ...full, captureHints: ["hair_not_visible"] },
      { ...full, notAssessed: [{ sub: "hair", reason: "covered" }] },
      { ...full, notAssessed: [{ sub: "jawline", reason: "excluded" }] },
      { ...full, explain: { harmony: [{ key: "symmetry", status: "outside" }] } },
      { ...full, explain: { harmony: [{ key: "symmetry", status: "in_band" }] } },
      { ...full, explain: { skin: [{ key: "evenness", status: "partial" }] } },
      { ...full, explain: { skin: [{ key: "blemishes", status: "measured" }] } },
      { ...full, explain: { photo: [{ key: "blemishes", status: "best" }] } },
    ];
    for (const b of bad) expect(ClientSignals.safeParse(b).success, JSON.stringify(b)).toBe(false);
  });

  it("hiçbir dışa aktarılan anahtar veya değer bir örtü adı taşımaz (covered/hijab)", () => {
    const text = JSON.stringify(contract, (_k, v: unknown) => (typeof v === "function" ? undefined : v)) + JSON.stringify(full);
    expect(text).not.toMatch(/covered|hijab|örtü|ortu/i);
    expect(Object.keys(contract).join(",")).not.toMatch(/covered|hijab/i);
  });

  it("kaldıraç sözlüğü: 9 anahtar, sıra = eşitlik sırası, sakal kaldıracı bakımda", () => {
    expect(LEVER_KEYS).toEqual([
      "lv_blemish_care",
      "lv_texture_smooth",
      "lv_daily_spf",
      "lv_shine_balance",
      "lv_hair_styling",
      "lv_haircut_refresh",
      "lv_brow_tidy",
      "lv_lip_care",
      "lv_beard_lineup",
    ]);
    for (const k of LEVER_KEYS) expect(MOD_SUBS).toContain(LEVER_SUB[k]);
    expect(BEARD_LEVERS).toEqual(["lv_beard_lineup"]);
    expect(MOD_EXPLAIN_KEYS).not.toContain("evenness");
    expect(CAPTURE_HINTS.some((h) => h.startsWith("hair"))).toBe(false);
  });
});

describe("ANALYSIS_ROW_COLUMNS (sözleşme C8)", () => {
  it("mevcut 11 sütun + prompt_version, engine_version, signals; ai_usage istemci yoluna seçilmez", () => {
    const cols = ANALYSIS_ROW_COLUMNS.split(",").map((c) => c.trim());
    expect(cols).toEqual([
      "id",
      "status",
      "created_at",
      "face_shape",
      "overall",
      "potential",
      "subscores",
      "gains",
      "observations",
      "geometry",
      "calibration_version",
      "prompt_version",
      "engine_version",
      "signals",
    ]);
    expect(cols).not.toContain("ai_usage");
  });
});

describe("skor yapılandırması (UI spec S5, engine spec §1.2, §9.2)", () => {
  it("referans 5,5 = v0 hedefi; hybrid rozetlerinde çene hattı yapısal, eski rozetler değişmedi", () => {
    expect(CALIBRATION_REFERENCE).toBe(CALIBRATION_V0.target);
    expect(SUB_KIND_HYBRID.jawline).toBe("structural");
    expect(SUB_KIND.jawline).toBe("partial");
    for (const k of SUB_KEYS) if (k !== "jawline") expect(SUB_KIND_HYBRID[k]).toBe(SUB_KIND[k]);
  });

  it("SCORE_ENGINE: varsayılan legacy; geçersiz değer legacy; asla fırlatmaz", () => {
    expect(getScoreEngine({})).toBe("legacy");
    expect(getScoreEngine({ SCORE_ENGINE: "" })).toBe("legacy");
    expect(getScoreEngine({ SCORE_ENGINE: "claude" })).toBe("legacy");
    expect(getScoreEngine({ SCORE_ENGINE: "hybrid.v1" })).toBe("hybrid.v1");
    expect(getScoreEngine({ SCORE_ENGINE: " hybrid.v1 " })).toBe("hybrid.v1");
    expect(getScoreEngine({ SCORE_ENGINE: "legacy" })).toBe("legacy");
  });

  it("üretim kapısı: hazır değilse production'da hybrid.v1 ve Claude koç engellenir; diğer ortamlar serbest", () => {
    const ready: EngineReadiness = { norms: "fitted", categories: "fitted", legal: "approved" };
    const prod = { VERCEL_ENV: "production", SCORE_ENGINE: "hybrid.v1" };
    expect(scoreEngineBlocked(prod, ready)).toBe(false);
    expect(scoreEngineBlocked(prod, { ...ready, norms: "provisional" })).toBe(true);
    expect(scoreEngineBlocked(prod, { ...ready, categories: "provisional" })).toBe(true);
    expect(scoreEngineBlocked(prod, { ...ready, legal: "pending" })).toBe(true);
    const notReady: EngineReadiness = { norms: "provisional", categories: "provisional", legal: "pending" };
    expect(scoreEngineBlocked({ VERCEL_ENV: "preview", SCORE_ENGINE: "hybrid.v1" }, notReady)).toBe(false);
    expect(scoreEngineBlocked({ SCORE_ENGINE: "hybrid.v1" }, notReady)).toBe(false);
    expect(scoreEngineBlocked({ VERCEL_ENV: "production", SCORE_ENGINE: "legacy" }, notReady)).toBe(false);
    expect(scoreEngineBlocked({ VERCEL_ENV: "production", AI_COACH_PROVIDER: "claude" }, notReady, "coach")).toBe(true);
    expect(scoreEngineBlocked({ VERCEL_ENV: "production", AI_COACH_PROVIDER: "gemini" }, notReady, "coach")).toBe(false);
    expect(scoreEngineBlocked({ VERCEL_ENV: "production", AI_COACH_PROVIDER: "claude" }, ready, "coach")).toBe(false);
  });
});

describe("oturum selfie'si analize bağlanır (UI spec S1)", () => {
  const selfie = (capturedAt: number): SessionSelfie => {
    const bitmap: Pick<ImageBitmap, "close" | "width" | "height"> = { close: () => {}, width: 1, height: 1 };
    return { bitmap: bitmap as ImageBitmap, width: 1, height: 1, landmarks: [], capturedAt };
  };

  it("yalnız aynı çekim (capturedAt) bağlanır; yeni çekim eski bağı taşımaz", () => {
    setSessionSelfie(selfie(100));
    bindSessionSelfie("a-1", 99);
    expect(getSessionSelfie()?.analysisId).toBeUndefined();
    bindSessionSelfie("a-1", 100);
    expect(getSessionSelfie()?.analysisId).toBe("a-1");
    setSessionSelfie(selfie(200));
    expect(getSessionSelfie()?.analysisId).toBeUndefined();
    setSessionSelfie(null);
    bindSessionSelfie("a-2", 200);
    expect(getSessionSelfie()).toBeNull();
  });
});
