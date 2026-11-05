import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: { baseURL, trace: "retain-on-failure" },
  projects: [
    {
      name: "mobile-chrome",
      testIgnore: /(privacy|billing|flow)\.spec\.ts/,
      use: {
        ...devices["Pixel 7"],
        // Önceden kurulu bir Chromium kullanmak için (CI/sandbox): PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
      },
    },
    ...(process.env.BILLING_E2E ? [{ name: "billing", testMatch: /billing\.spec\.ts/, use: { ...devices["Pixel 7"] } }] : []),
    // Ana akış (SPEC Faz 15 madde 1): gerçek Supabase + sahte kamera videosu; FULL_FLOW_E2E=1 ile çalışır.
    ...(process.env.FULL_FLOW_E2E
      ? [
          {
            name: "flow",
            testMatch: /flow\.spec\.ts/,
            fullyParallel: false,
            use: {
              ...devices["Pixel 7"],
              permissions: ["camera"],
              launchOptions: {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
                args: [
                  "--use-fake-ui-for-media-stream",
                  "--use-fake-device-for-media-stream",
                  `--use-file-for-fake-video-capture=${process.env.E2E_FACE_VIDEO ?? process.env.PRIVACY_FACE_VIDEO ?? ""}`,
                ],
              },
            },
          },
        ]
      : []),
    // Gizlilik testi (CLAUDE.md): gerçek Supabase + sahte kamera dosyası ister; PRIVACY_E2E=1 ile çalışır.
    ...(process.env.PRIVACY_E2E
      ? [
          {
            name: "privacy",
            testMatch: /privacy\.spec\.ts/,
            use: {
              ...devices["Pixel 7"],
              permissions: ["camera"],
              launchOptions: {
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH,
                args: [
                  "--use-fake-ui-for-media-stream",
                  "--use-fake-device-for-media-stream",
                  `--use-file-for-fake-video-capture=${process.env.PRIVACY_FACE_VIDEO ?? ""}`,
                ],
              },
            },
          },
        ]
      : []),
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : { command: "pnpm start", url: baseURL, reuseExistingServer: !process.env.CI, timeout: 120_000 },
});
