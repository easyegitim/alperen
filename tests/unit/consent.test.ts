import { describe, expect, it } from "vitest";
import { CONSENT_DOC, CONSENT_TYPES, REQUIRED_ANALYSIS_CONSENTS, hasRequiredAnalysisConsents } from "@/lib/consent";

const version = () => "2026-10-09.1";

describe("rızalar (SPEC 16.2)", () => {
  it("10 rıza türü ve her birinin bir metin kaynağı var", () => {
    expect(CONSENT_TYPES).toHaveLength(10);
    for (const t of CONSENT_TYPES) expect(CONSENT_DOC[t]).toBeTruthy();
  });
  it("üç zorunlu rıza verilmeden analiz izni yok", () => {
    expect(hasRequiredAnalysisConsents({}, version)).toBe(false);
    expect(
      hasRequiredAnalysisConsents(
        { biometric_processing: { granted: true, textVersion: version() }, photo_ai_analysis: { granted: true, textVersion: version() } },
        version,
      ),
    ).toBe(false);
  });
  it("eski metin sürümüyle verilen rıza geçersiz sayılır", () => {
    const state = Object.fromEntries(REQUIRED_ANALYSIS_CONSENTS.map((t) => [t, { granted: true, textVersion: "eski" }]));
    expect(hasRequiredAnalysisConsents(state, version)).toBe(false);
  });
  it("üçü de güncel sürümle verilmişse izin var", () => {
    const state = Object.fromEntries(REQUIRED_ANALYSIS_CONSENTS.map((t) => [t, { granted: true, textVersion: version() }]));
    expect(hasRequiredAnalysisConsents(state, version)).toBe(true);
  });
});
