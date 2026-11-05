/** M0 çıkış kriteri: paylaşılan saf modüller mobil derleme zinciriyle (babel alias "@/") çalışır. */
import { Linter } from "eslint";
import { PLANS } from "@/lib/config/plans";
import { CALIBRATION_REFERENCE } from "@/lib/config/scoring";
import { calibrate } from "@/lib/score/calibration";
import { getOnboardingRedirect } from "@/lib/onboarding/gate";
import { REQUIRED_ANALYSIS_CONSENTS } from "@/lib/consent";

describe("paylaşılan modüller (SPEC-MOBILE M1)", () => {
  it("planlar ve kalibrasyon kökten gelir", () => {
    expect(Object.keys(PLANS)).toContain("monthly");
    expect(calibrate(6.5, "v0")).toBe(5.5);
  });
  it("hybrid.v1 kalibrasyonu (h1) birim dönüşüm ve herkese aynı referans 5,5", () => {
    expect(calibrate(6.5, "h1")).toBe(6.5);
    expect(CALIBRATION_REFERENCE).toBe(5.5);
  });
  it("onboarding kapısı ve rızalar aynı kurallardır", () => {
    expect(getOnboardingRedirect(null)).toBe("/baslangic/yas");
    expect(REQUIRED_ANALYSIS_CONSENTS).toHaveLength(3);
  });
});

describe("sunucu motoru mobilden içe aktarılamaz (engine spec §8, §11 #19)", () => {
  // Kural mobil ESLint yapılandırmasının kendisinden okunur (sabit kopya değil); yapılandırma dosyası yüklemesi
  // Jest'te dinamik import gerektirdiği için kural tek başına Linter ile çalıştırılır.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- CommonJS yapılandırma dosyası
  const config: { rules?: Record<string, Linter.RuleEntry> }[] = require("../eslint.config.js");
  const entry = config.find((c) => c.rules?.["no-restricted-imports"]);
  const linter = new Linter({ configType: "flat" });
  const restricted = (code: string) =>
    linter
      .verify(code, [{ files: ["**/*.js"], rules: { "no-restricted-imports": entry?.rules?.["no-restricted-imports"] ?? "off" } }], "fixture.js")
      .filter((m) => m.ruleId === "no-restricted-imports").length;

  it("yapılandırmada kural tanımlı", () => {
    expect(entry).toBeDefined();
  });

  it.each([
    'import { scoreHybrid } from "@/lib/score/engine";',
    'import { scoreModifiable } from "@/lib/score/engine/categories";',
    'import { scoreAnalysis } from "@/lib/score/service";',
    'import { WEIGHTS_H1 } from "@/lib/config/engine.server";',
    'import { getAiEnv } from "@/lib/config/ai.server";',
  ])("%s → lint hatası", (code) => {
    expect(restricted(code)).toBeGreaterThan(0);
  });

  it("paylaşılan saf modüller serbest", () => {
    expect(restricted('import { calibrate } from "@/lib/score/calibration";\nimport { LEVERS } from "@/content/levers";')).toBe(0);
  });
});
