// UI spec S4, S5, S6, §8.2: analitiğe ve arayüze giden yapılandırma değerleri skor, metrik, e-posta veya görsel taşımaz.
import { describe, expect, it } from "vitest";
import { getPublicEngineInfo, NEUTRAL_PROVIDER_NAME } from "@/lib/ai/disclosure.server";
import type { AnalyticsEventName } from "@/lib/analytics";
import { sanitizeProps } from "@/lib/analytics";
import { isFeatureEnabled } from "@/lib/config/flags";
import { FAIRNESS_LAST_RUN, METHOD_FROM } from "@/lib/config/method";
import { PAYWALL_TRIGGERS, TEASER_ANALYTICS_CODE } from "@/lib/config/paywall";
import { SUB_KEYS, TEASER_MODES } from "@/lib/config/teaser";

const FORBIDDEN = /overall|lengthRatio|@|\/9j\//;

/** Derleme zamanında tam: AnalyticsEvents'e eklenen her olay burada listelenmek zorunda. */
const EVENT_NAMES: Record<AnalyticsEventName, true> = {
  landing_cta_clicked: true,
  anon_session_started: true,
  age_blocked: true,
  consent_updated: true,
  questionnaire_completed: true,
  capture_started: true,
  capture_quality_failed: true,
  capture_succeeded: true,
  analysis_completed: true,
  analysis_failed: true,
  paywall_viewed: true,
  account_linked: true,
  checkout_started: true,
  subscription_activated: true,
  purchase_completed: true,
  subscription_canceled: true,
  report_viewed: true,
  tryon_started: true,
  tryon_result: true,
  share_card_created: true,
  routine_checked: true,
  expert_request_sent: true,
  feedback_sent: true,
  account_deletion_requested: true,
  result_viewed: true,
  overlay_opened: true,
  method_viewed: true,
  paywall_step_viewed: true,
  paywall_plan_selected: true,
  paywall_dismissed: true,
  capture_manual_offered: true,
  capture_manual_used: true,
  improve_first_clicked: true,
  plan_basis_edit_clicked: true,
};

describe("paywall yapılandırması (UI spec S4)", () => {
  it("tetikleyiciler: sabit adlar + her alt skor için sub_<k>; tekrar yok", () => {
    expect(PAYWALL_TRIGGERS.slice(0, 6)).toEqual(["score_main", "score_potential", "improve_first", "measurements", "plan", "plan_page"]);
    for (const k of SUB_KEYS) expect(PAYWALL_TRIGGERS).toContain(`sub_${k}`);
    expect(new Set(PAYWALL_TRIGGERS).size).toBe(PAYWALL_TRIGGERS.length);
  });

  it("her teaser modunun kısa, benzersiz bir analitik kodu var", () => {
    expect(Object.keys(TEASER_ANALYTICS_CODE).sort()).toEqual([...TEASER_MODES].sort());
    expect(new Set(Object.values(TEASER_ANALYTICS_CODE)).size).toBe(TEASER_MODES.length);
  });

  it("hiçbir tetikleyici, kod, olay adı veya yöntem kaynağı yasak kalıba uymaz (privacy.spec adım 3)", () => {
    const values = [...PAYWALL_TRIGGERS, ...Object.values(TEASER_ANALYTICS_CODE), ...Object.keys(EVENT_NAMES), ...METHOD_FROM];
    for (const v of values) expect(v, v).not.toMatch(FORBIDDEN);
  });

  it("yeni olayların özellikleri temizleyiciden aynen geçer (yasak anahtar yok)", () => {
    const props: Record<string, unknown>[] = [
      { tier: "free", overlay: "photo", legacy: false },
      { source: "schematic" },
      { from: "guide" },
      { step: "plans", trigger: "score_potential" },
      { plan: "yearly" },
      { step: "benefits" },
      { issue: "too_dark" },
      { position: 1 },
    ];
    for (const p of props) expect(sanitizeProps(p)).toEqual(p);
  });
});

describe("yöntem sayfası ve açıklama (UI spec S5, S6)", () => {
  it("METHOD_FROM kapalı liste; adalet ölçümü onaylı koşuya kadar yok", () => {
    expect(METHOD_FROM).toEqual(["guide", "result", "paywall", "footer", "pricing", "direct"]);
    expect(FAIRNESS_LAST_RUN).toBeNull();
  });

  it("FEATURE_PROVIDER_NAMES varsayılan kapalı", () => {
    expect(isFeatureEnabled("providerNames", {})).toBe(false);
    expect(isFeatureEnabled("providerNames", { FEATURE_PROVIDER_NAMES: "true" })).toBe(true);
  });

  it("bayrak kapalıyken sağlayıcı adları nötr; varsayılan motor legacy", () => {
    const info = getPublicEngineInfo({ SCORE_ENGINE: "hybrid.v1", TRYON_PROVIDER: "fal" });
    expect(info).toEqual({
      engine: "hybrid.v1",
      calibrationVersion: "h1",
      analysisProvider: NEUTRAL_PROVIDER_NAME,
      tryonProvider: NEUTRAL_PROVIDER_NAME,
      structuralSharePct: 40,
    });
    expect(getPublicEngineInfo({}).engine).toBe("legacy");
    expect(getPublicEngineInfo({}).structuralSharePct).toBeNull();
    expect(getPublicEngineInfo({}).calibrationVersion).toBe("v0");
  });

  it("bayrak açıkken motor ve deneme sağlayıcısının görünen adları", () => {
    const on = { FEATURE_PROVIDER_NAMES: "true" };
    expect(getPublicEngineInfo({ ...on, SCORE_ENGINE: "hybrid.v1" }).analysisProvider).toBe("Anthropic (Claude)");
    expect(getPublicEngineInfo({ ...on, SCORE_ENGINE: "legacy", SCORE_CALIBRATION_VERSION: "v1" })).toMatchObject({
      analysisProvider: "Google (Gemini)",
      calibrationVersion: "v1",
      tryonProvider: "Google (Gemini)",
    });
    expect(getPublicEngineInfo({ ...on, TRYON_PROVIDER: "fal" }).tryonProvider).toBe("fal.ai");
  });

  it("gizli değer asla dönmez", () => {
    const secret = "sk-ant-test-SECRET-123";
    const info = getPublicEngineInfo({ FEATURE_PROVIDER_NAMES: "true", SCORE_ENGINE: "hybrid.v1", ANTHROPIC_API_KEY: secret, GEMINI_API_KEY: secret, FAL_KEY: secret });
    expect(JSON.stringify(info)).not.toContain(secret);
  });
});
