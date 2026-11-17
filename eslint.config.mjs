import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Üçüncü taraf çalışma zamanı dosyaları (pnpm mediapipe:setup kopyalar)
    "public/**",
    // Mobil uygulama kendi ESLint yapılandırmasıyla denetlenir (mobile/eslint.config.js)
    "mobile/**",
  ]),
]);

export default eslintConfig;
