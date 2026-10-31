// Statik export (BLUEPRINT §7): sunucu yok, panelde gizli anahtar yok; Cloudflare Pages `out/` dizinini yayınlar.
// experimental.externalDir: depo kökündeki docs/hukuk/*.md (veli onay metni) ve mock modunda fixtures/*.json derleme anında içe alınır.
//
// Güvenlik kuralları (README "Veri kaynağı ve derleme"):
// 1. Üretim derlemesi NEXT_PUBLIC_DATA_SOURCE'u AÇIKÇA ister (live | mock). Unutulan değişken girişsiz, sahte verili ve
//    herkese açık rol seçicili bir panel yayınlamasın diye derleme durur.
// 2. live derlemesinde lib/data/mock.ts paketlenmez: NormalModuleReplacementPlugin onu lib/data/mock-unavailable.ts ile
//    değiştirir. Böylece fixtures/db/dev-seed.json (secure.answer_keys, secure.student_pii, guardian_codes …) istemciye
//    hiçbir zaman gitmez (§2.1, §3.4 ilke 7–8). test/build-output.test.ts bunu ayrı bir live derlemesiyle doğrular.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PHASE_PRODUCTION_BUILD = 'phase-production-build';
const MODES = ['live', 'mock'];

/** @param {string} phase */
export default function config(phase) {
  const mode = process.env.NEXT_PUBLIC_DATA_SOURCE;
  if (phase === PHASE_PRODUCTION_BUILD && !MODES.includes(mode ?? '')) {
    throw new Error(
      `NEXT_PUBLIC_DATA_SOURCE "live" ya da "mock" olmalı (şu an: ${mode === undefined ? 'tanımsız' : JSON.stringify(mode)}). ` +
        'Üretim derlemesi veri kaynağını açıkça seçmeden yapılmaz.',
    );
  }
  /** @type {import('next').NextConfig} */
  const nextConfig = {
    output: 'export',
    images: { unoptimized: true },
    reactStrictMode: true,
    poweredByHeader: false,
    eslint: { ignoreDuringBuilds: true },
    experimental: { externalDir: true },
    // Ayrı dağıtım dizini (yalnız testler: canlı derleme denetimi `out/`'u ezmez).
    ...(process.env.PANEL_DIST_DIR ? { distDir: process.env.PANEL_DIST_DIR } : {}),
    webpack(webpackConfig, { webpack }) {
      // `import text from '…/veli-onay-formu.md?raw'` → dize (vitest/Vite'ın ?raw davranışıyla aynı)
      webpackConfig.module.rules.push({ test: /\.md$/, resourceQuery: /raw/, type: 'asset/source' });
      if (mode === 'live') {
        webpackConfig.plugins.push(
          new webpack.NormalModuleReplacementPlugin(/[\\/]lib[\\/]data[\\/]mock(\.ts)?$/, join(HERE, 'lib', 'data', 'mock-unavailable.ts')),
        );
      }
      return webpackConfig;
    },
  };
  return nextConfig;
}
