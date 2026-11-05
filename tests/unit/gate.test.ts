import { describe, expect, it } from "vitest";
import { AGE_GATE_PATH, CONSENTS_PATH, DELETION_PATH, getOnboardingRedirect } from "@/lib/onboarding/gate";

describe("getOnboardingRedirect (SPEC Faz 2 madde 5, Faz 13 madde 4)", () => {
  it("profil yoksa yaş kapısı", () => {
    expect(getOnboardingRedirect(null)).toBe(AGE_GATE_PATH);
  });
  it("18+ değilse yaş kapısı", () => {
    expect(getOnboardingRedirect({ is_adult: false, onboarding_completed_at: "2026-10-09T00:00:00Z" })).toBe(AGE_GATE_PATH);
  });
  it("18+ ama onboarding bitmemişse izinler", () => {
    expect(getOnboardingRedirect({ is_adult: true, onboarding_completed_at: null })).toBe(CONSENTS_PATH);
  });
  it("ikisi de tamamsa yönlendirme yok", () => {
    expect(getOnboardingRedirect({ is_adult: true, onboarding_completed_at: "2026-10-09T00:00:00Z" })).toBeNull();
  });
  it("silme talebi bekliyorsa /silme (onboarding tamam olsa da)", () => {
    expect(getOnboardingRedirect({ is_adult: true, onboarding_completed_at: "2026-10-09T00:00:00Z", deletion_requested_at: "2026-10-12T00:00:00Z" })).toBe(DELETION_PATH);
    expect(getOnboardingRedirect({ is_adult: true, onboarding_completed_at: null, deletion_requested_at: "2026-10-12T00:00:00Z" })).toBe(DELETION_PATH);
  });
});
