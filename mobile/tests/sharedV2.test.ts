/**
 * SPEC-MOBILE M1 / CONTRACTS_V2 Sprint 3 S3.2: mobil ekranların içe aktaracağı her paylaşılan modül saftır
 * (server-only, next/*, DOM yok) ve mobil babel/jest zinciriyle yüklenir. Bu dosya her birini gerçekten içe aktarır.
 */
import { Linter } from "eslint";
import { AnalysisInputRaw, ANALYSIS_MODES } from "@/lib/api/analysesInput";
import { TryonInputV2Raw, TRYON_IMAGE_MAX_BYTES } from "@/lib/api/tryonInput";
import { formatRemaining, offerState } from "@/lib/billing/offer";
import { canConsumePurchaseFor } from "@/lib/billing/entitlement";
import { PLAN_V2_VERSION, buildPriorityTable } from "@/lib/coach/planTypes";
import { PLAN_PHASES, PLAN_AREAS } from "@/lib/config/plan";
import { ROUTINE_FORGIVING, getRoutineForgiving } from "@/lib/config/routine";
import { NOISE_BAND } from "@/lib/config/scoring";
import { GHOST_POINT_COUNT, ghostOutlineFromLandmarks, ghostPolylines } from "@/lib/face/ghostGuide";
import { LANDMARK_COUNT } from "@/lib/face/indices";
import { VIEW_KEYS, checkViewSet, classifyView } from "@/lib/face/views";
import { AGE_BANDS, isAdultByAgeBand } from "@/lib/onboarding/age";
import { classifyChange } from "@/lib/progress/noise";
import { latestChange } from "@/lib/progress/trend";
import { claimErrorKey, referralRatio } from "@/lib/referral/claim";
import { QUESTIONNAIRE_V2_VERSION, emptyQuestionnaireV2, hairAdviceAllowedV2 } from "@/lib/questionnaireV2";
import { freezeStoreError, recentDays } from "@/lib/routine/calendar";
import { computeForgivingStreak } from "@/lib/routine/forgiving";
import { ANALYSIS_STAGES, REGION_KEYS, SECTION_KEYS } from "@/lib/score/contract";
import { NOISE_BAND_CLIENT, stageOf } from "@/lib/score/present";
import { SHARE_CARD_KINDS, shareSpecIssues, strongestSub } from "@/lib/share/spec";
import { TRYON_MODES, maskRegionFor, qcPass } from "@/lib/tryon/types";
import { SPRINT3_EVENTS } from "@/lib/analytics";
import { isMobileFeatureEnabled } from "@/mobile/src/lib/flags";

describe("paylaşılan v2 modülleri mobilden yüklenir (CONTRACTS_V2 Sprint 3 S3.2)", () => {
  it("sözlükler ve sabitler", () => {
    expect(ANALYSIS_STAGES).toContain("device_only");
    expect(SECTION_KEYS[0]).toBe("device");
    expect(REGION_KEYS).toHaveLength(9);
    expect(VIEW_KEYS).toHaveLength(6);
    expect(ANALYSIS_MODES).toEqual(["device_only", "full"]);
    expect(AGE_BANDS).toContain("under_18");
    expect(isAdultByAgeBand("18_24")).toBe(true);
    expect(PLAN_V2_VERSION).toBe("plan.v2");
    expect(PLAN_PHASES).toHaveLength(3);
    expect(PLAN_AREAS).toContain("hair");
    expect(QUESTIONNAIRE_V2_VERSION).toBe("q.v2");
    expect(TRYON_MODES).toEqual(["style", "combo", "glow_up"]);
    expect(TRYON_IMAGE_MAX_BYTES).toBeGreaterThan(0);
    expect(SHARE_CARD_KINDS).toEqual(["score", "strongest", "barber"]);
    expect(SPRINT3_EVENTS).toContain("ghost_guide_shown");
  });
  it("saf fonksiyonlar web ile aynı sonucu verir", () => {
    expect(checkViewSet(["front", "profile_left"], "full")).toEqual({ ok: true });
    expect(checkViewSet(["front"], "full")).toEqual({ ok: false, reason: "profile_missing" });
    expect(classifyView(0).view).toBe("front");
    expect(stageOf("processing")).toBe("running");
    expect(NOISE_BAND).toBe(0.3);
    expect(NOISE_BAND_CLIENT).toBe(NOISE_BAND);
    expect(classifyChange(6.2, 6.4).kind).toBe("no_change");
    expect(hairAdviceAllowedV2(emptyQuestionnaireV2({ headCoveringDetected: true }))).toBe(false);
    expect(buildPriorityTable([{ id: "a", impact: 3, effort: 1 }, { id: "b", impact: 1, effort: 3 }])[0].stepId).toBe("a");
    expect(maskRegionFor("combo", { hair: "h", beard: "b" })).toBe("features_cheeks");
    expect(qcPass({ identityKept: true, styleApplied: true, strayHairCleared: true, artifacts: "none", reasons: [] })).toBe(true);
    expect(canConsumePurchaseFor({ entitled: false, unconsumedOneTimeId: "p1" }, "device_only")).toBe(true);
    expect(formatRemaining(3_661_000)).toBe("01:01:01");
    const o = offerState({ user_id: "u", started_at: "2026-11-04T00:00:00Z", expires_at: "2026-11-05T00:00:00Z", promo_product: "one_time_report", regular_product: "one_time_report" }, new Date("2026-11-04T12:00:00Z"), {});
    expect(o.active).toBe(true);
    expect(strongestSub({ eyes: { value: 7 }, skin: { value: 6 } })).toBe("eyes");
    expect(shareSpecIssues({ kind: "score", format: "square", audience: "marketing", appName: "Aura", url: "aura.app", disclaimer: "x", withPhoto: true, overall: 6, potential: null, subs: [] })).toContain("photo_on_marketing_card");
  });
  it("affedici seri ve hayalet kılavuz cihazda hesaplanır", () => {
    expect(ROUTINE_FORGIVING.placeholder).toBe(true);
    expect(getRoutineForgiving({ EXPO_PUBLIC_ROUTINE_REST_DAYS_PER_WEEK: "2" }).restDaysPerWeek).toBe(2);
    const logs = ["2026-11-01", "2026-11-02", "2026-11-04"].flatMap((d) => [{ log_date: d, item_id: "a", done: true }]);
    expect(computeForgivingStreak({ logs, activeItemCount: 1, today: "2026-11-04" }).streak).toBe(3);
    expect(recentDays({ logs, activeItemCount: 1, today: "2026-11-04", days: 4 }).map((d) => d.status)).toEqual(["done", "done", "rest", "done"]);
    expect(freezeStoreError({ code: "PGRST205", message: "" })).toBe("unavailable");
    expect(latestChange([{ id: "a", date: "2026-10-01", overall: 6.0, calibrationVersion: "h2" }, { id: "b", date: "2026-11-01", overall: 6.2, calibrationVersion: "h2" }])?.change?.kind).toBe("no_change");
    expect(claimErrorKey("BAD_INPUT", "device_check_failed")).toBe("device");
    expect(referralRatio(2, 5)).toBe(0.4);
    const landmarks = Array.from({ length: LANDMARK_COUNT }, (_, i) => ({ x: (i % 64) * 10, y: Math.floor(i / 64) * 60 }));
    const outline = ghostOutlineFromLandmarks(landmarks, 640, 480, { mirrored: true, takenAt: 1 });
    expect(outline?.oval).toHaveLength(36);
    expect(GHOST_POINT_COUNT).toBe(43);
    expect(ghostPolylines(outline!, { w: 360, h: 640 }, { mirror: true }).oval).toHaveLength(36);
  });
  it("Zod şemaları çalışır (mobil istemci de gövdeyi gönderim öncesi doğrulayabilir)", () => {
    expect(AnalysisInputRaw.safeParse({ clientRequestId: "x" }).success).toBe(false);
    expect(TryonInputV2Raw.safeParse({ clientRequestId: "x" }).success).toBe(false);
  });
  it("v2 bayrakları mobil aynada; varsayılanlar web ile aynı", () => {
    expect(isMobileFeatureEnabled("glowUp", {})).toBe(true);
    expect(isMobileFeatureEnabled("tryonCombo", { tryonCombo: "false" })).toBe(false);
    expect(isMobileFeatureEnabled("referralUnlock", {})).toBe(false);
    expect(isMobileFeatureEnabled("under18", { under18: "true" })).toBe(true);
  });
});

describe("M1 içe aktarma kuralı: Sprint 3 paylaşılan modülleri serbest, sunucu/DOM modülleri yasak", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS yapılandırma dosyası
  const config: { rules?: Record<string, Linter.RuleEntry> }[] = require("../eslint.config.js");
  const entry = config.find((c) => c.rules?.["no-restricted-imports"]);
  const linter = new Linter({ configType: "flat" });
  const restricted = (code: string) =>
    linter
      .verify(code, [{ files: ["**/*.js"], rules: { "no-restricted-imports": entry?.rules?.["no-restricted-imports"] ?? "off" } }], "fixture.js")
      .filter((m) => m.ruleId === "no-restricted-imports").length;

  it.each([
    'import { shareSpecIssues } from "@/lib/share/spec";',
    'import { offerState } from "@/lib/billing/offer";',
    'import { canConsumePurchaseFor } from "@/lib/billing/entitlement";',
    'import { computeForgivingStreak } from "@/lib/routine/forgiving";',
    'import { classifyChange } from "@/lib/progress/noise";',
    'import { latestChange } from "@/lib/progress/trend";',
    'import { recentDays } from "@/lib/routine/calendar";',
    'import { claimErrorKey } from "@/lib/referral/claim";',
    'import { ghostOutlineFromLandmarks } from "@/lib/face/ghostGuide";',
    'import { PlanV2 } from "@/lib/coach/planTypes";',
    'import { QuestionnaireV2Schema } from "@/lib/questionnaireV2";',
  ])("%s serbest", (code) => {
    expect(restricted(code)).toBe(0);
  });
  it.each([
    'import { renderShareCard } from "@/lib/share/card";',
    'import { getAccessV2 } from "@/lib/billing/purchases";',
    'import { generatePlanV2 } from "@/lib/coach/generatePlan";',
    'import { NOISE_BAND } from "@/lib/config/engine.h2.server";',
    'import { addProgressPhoto } from "@/lib/local/progressStore";',
  ])("%s yasak", (code) => {
    expect(restricted(code)).toBeGreaterThan(0);
  });
});
