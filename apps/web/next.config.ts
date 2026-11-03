import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import withSerwistInit from '@serwist/next';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '../..');

// Üretim derlemesi webpack ile yapılır (Serwist eklentisi Turbopack'te çalışmaz); geliştirmede Turbopack + kapalı SW kullanılır.
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
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // E2E derlemesi (sahte Supabase adresiyle) ayrı dizine yazılır; normal .next bozulmaz.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  // `next dev` yönetilen AGENTS.md üretmesin (depoda ajan yönergeleri elle yönetilir).
  agentRules: false,
  poweredByHeader: false,
  // Tasarım sistemi kaynak olarak paylaşılır (derleme yok).
  transpilePackages: ['@ogrenmen/design-system'],
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
