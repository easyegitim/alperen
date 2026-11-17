const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  ...expoConfig,
  { ignores: ["dist/*", "ios/*", "android/*", ".expo/*"] },
  // Node ortamında çalışan yapılandırma/eklenti/betik dosyaları
  { files: ["plugins/**/*.js", "scripts/**/*.mjs", "*.config.js"], languageOptions: { globals: { __dirname: "readonly", require: "readonly", module: "writable", process: "readonly", console: "readonly" } } },
  { ignores: ["modules/*/android/**", "modules/*/ios/**"] },
  { files: ["tests/setup/**/*.js"], languageOptions: { globals: { jest: "readonly", require: "readonly" } } },
  {
    rules: {
      // SPEC-MOBILE M1: sunucu ve DOM'a bağlı modüller mobilden içe aktarılmaz. hybrid.v1 motoru (bantlar, deltalar,
      // ağırlıklar) yalnız sunucudadır: istemci kilitli bir alt skoru yeniden hesaplayamasın (engine spec §8).
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "server-only", message: "Sunucu modülü; mobilde kullanılamaz." }],
          patterns: [
            { group: ["next", "next/*", "react-dom", "react-dom/*"], message: "Next/DOM modülü; mobilde kullanılamaz." },
            { group: ["@/lib/db/*", "@/lib/api/guard", "@/lib/api/premium", "@/lib/api/admin", "@/lib/ai/*", "!@/lib/ai/reportSchema", "!@/lib/ai/scoreSchema", "@/lib/billing/*", "!@/lib/billing/revenuecat", "!@/lib/billing/offer", "!@/lib/billing/entitlement", "@/lib/coach/generate", "@/lib/coach/reportsStore", "@/lib/coach/generatePlan", "@/lib/coach/planStore", "@/lib/doctor/*", "@/lib/referral/server", "@/lib/referral/verify", "@/lib/referral/links", "@/lib/onboarding/presentation", "@/lib/onboarding/profileRead", "@/lib/api/quota", "@/lib/tryon/quota", "@/lib/tryon/*.server", "@/lib/face/sessionStore", "@/lib/score/engine", "@/lib/score/engine/*", "@/lib/score/service", "@/lib/config/*.server", "@/lib/config/*.server.ts", "@/lib/experts/*", "@/lib/legal/*", "@/lib/email/*", "@/lib/face/vision.worker", "@/lib/face/client", "@/lib/face/preprocess", "@/lib/local/*", "@/lib/share/*", "!@/lib/share/spec", "@/lib/security/*", "@/lib/monitoring/*", "!@/lib/monitoring/sentry", "@/app/*", "@/components/*"], message: "Sunucu/DOM modülü; SPEC-MOBILE M1 paylaşım listesine bak." },
          ],
        },
      ],
    },
  },
]);
