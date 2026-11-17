/// <reference lib="webworker" />
// Öğrenmen servis çalışanı (Serwist). Derleme: next build --webpack -> public/sw.js.
//  - Önceden önbellek: derleme çıktısı (JS/CSS/yazı tipleri) + /cevrimdisi yedek sayfası = çevrimdışı kabuk.
//  - Çalışma zamanı: /_next/static ve yazı tipleri CacheFirst, simgeler StaleWhileRevalidate; /_next/image ve Storage ağdan.
//  - Sayfa gezintileri (kişisel veri) ve /api ASLA önbelleğe alınmaz: ağ yoksa /cevrimdisi gösterilir.
//  - Web-push: 'push' ve 'notificationclick'.
import { CacheFirst, ExpirationPlugin, NetworkOnly, Serwist, StaleWhileRevalidate } from 'serwist';
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from 'serwist';
import { parsePushPayload, safePushUrl } from '../lib/push-payload';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const YEAR = 365 * 24 * 60 * 60;

const runtimeCaching: RuntimeCaching[] = [
  {
    // Kişisel görseller (avatar, yüklenen soru fotoğrafı, PDF küçük resmi) cihaz önbelleğine girmez.
    matcher: ({ url }) => url.pathname.startsWith('/_next/image') || url.pathname.includes('/storage/v1/'),
    handler: new NetworkOnly(),
  },
  {
    // Derlemenin içeriğe göre adlandırılmış (değişmez) dosyaları: token CSS'i, JS parçaları, yazı tipleri.
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/_next/static/'),
    handler: new CacheFirst({
      cacheName: 'og-static',
      plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: YEAR, maxAgeFrom: 'last-used' })],
    }),
  },
  {
    matcher: ({ request }) => request.destination === 'font',
    handler: new CacheFirst({
      cacheName: 'og-fonts',
      plugins: [new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: YEAR, maxAgeFrom: 'last-used' })],
    }),
  },
  {
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/icons/'),
    handler: new StaleWhileRevalidate({
      cacheName: 'og-images',
      plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 })],
    }),
  },
  {
    // Gezinti istekleri her zaman ağdan; başarısız olursa aşağıdaki fallbacks devreye girer.
    matcher: ({ request }) => request.mode === 'navigate',
    handler: new NetworkOnly(),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [{ url: '/cevrimdisi', matcher: ({ request }) => request.destination === 'document' }],
  },
});

serwist.addEventListeners();

self.addEventListener('push', (event) => {
  const display = parsePushPayload(event.data ? event.data.text() : null);
  event.waitUntil(
    self.registration.showNotification(display.title, {
      body: display.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: display.tag,
      data: { url: display.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  const url = safePushUrl(typeof data === 'object' && data !== null ? (data as { url?: unknown }).url : undefined);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) await (client as WindowClient).navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
