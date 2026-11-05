import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

// Derleme ve geliştirme webpack ile yapılır: Serwist eklentisi Turbopack'te çalışmaz ve Turbopack çalışma alanı
// paketlerindeki `./x.js` → `./x.ts` içe aktarımlarını çözmez (aşağıdaki extensionAlias; koç sayfası derlenmez). Geliştirmede SW kapalıdır.
process.env.SERWIST_SUPPRESS_TURBOPACK_WARNING ??= '1';

// Servis çalışanı: src/sw/sw.ts -> public/sw.js. Yalnız üretim derlemesinde açık (geliştirmede eski önbellek hata ayıklamayı bozar).
const withSerwist = withSerwistInit({
  swSrc: 'src/sw/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production',
  // Çevrimdışı yedek sayfa her derlemede yeniden önbelleğe alınır.
  additionalPrecacheEntries: [{ url: '/cevrimdisi', revision: process.env.GIT_SHA ?? String(Date.now()) }],
});

const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  // Kamera yalnızca kendi kökeninde (CameraSheet); mikrofon ve konum kapalı.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=()' },
];

const nextConfig: NextConfig = {
  // E2E derlemesi (sahte Supabase adresiyle) ayrı dizine yazılır; normal .next bozulmaz.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  // Geliştirme sunucusu 0.0.0.0'a bağlandığında (Docker kapsayıcısı) tarayıcı 127.0.0.1/localhost ile gelir: HMR ve
  // geliştirme kaynakları 'cross-origin' sayılıp engellenirse sayfa hidrasyonu yapılmaz (düğmeler çalışmaz).
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // `next dev` yönetilen AGENTS.md üretmesin (depoda ajan yönergeleri elle yönetilir).
  agentRules: false,
  poweredByHeader: false,
  // Çalışma alanı paketleri kaynak olarak paylaşılır (derleme yok). llm/prompts/contracts yalnız sunucuda (koç sohbeti
  // rota işleyicisi) kullanılır; ESM kaynakları `./x.js` ile `./x.ts`'i içe aktarır (extensionAlias aşağıda).
  transpilePackages: ['@ogrenmen/design-system', '@ogrenmen/llm', '@ogrenmen/prompts', '@ogrenmen/contracts'],
  webpack(config: { resolve?: { extensionAlias?: Record<string, string[]> }; module?: { rules?: unknown[] } }) {
    config.resolve ??= {};
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] };
    // packages/llm sahte taşıması fikstür dizinini `new URL('../fixtures/', import.meta.url)` ile bulur; webpack bunu
    // varlık bağımlılığı sanmasın (dizin çözülemez). Yalnız OGRENMEN_LLM=fake yolunda okunur.
    config.module ??= {};
    config.module.rules ??= [];
    config.module.rules.push({ test: /[\\/]packages[\\/]llm[\\/]src[\\/].*\.ts$/, parser: { url: false } });
    return config;
  },
  // Monorepo kökü: bun çalışma alanı sembolik bağlantılarını izleme kapsamına alır.
  outputFileTracingRoot: REPO_ROOT,
  turbopack: { root: REPO_ROOT },
  async headers() {
    return [
      { source: '/:path*', headers: SECURITY_HEADERS },
      {
        // Servis çalışanı hiçbir zaman HTTP önbelleğinde kalmaz; güncellemeler hemen görülür.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default withSerwist(nextConfig);
