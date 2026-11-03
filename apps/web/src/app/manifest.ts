import type { MetadataRoute } from 'next';

// PWA bildirimi: ad, simgeler (maskottan türetilmiş; apps/web/scripts/make-icons.mjs), tema rengi Öğrenmen mavisi.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Öğrenmen',
    short_name: 'Öğrenmen',
    description: 'Her öğrenciye kendi hızında eşlik eden AI öğretmen.',
    lang: 'tr',
    dir: 'ltr',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f6f8fc',
    theme_color: '#0030a2',
    categories: ['education'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Sor', short_name: 'Sor', url: '/ogrenci/sor', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
  };
}
