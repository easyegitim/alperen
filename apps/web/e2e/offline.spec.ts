import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { FAKE_ANON_KEY, FAKE_URL } from './fixtures.mjs';
import { signInAs } from './helpers';

// Gerçek bir çevrimdışı sınama: kendi Next sunucusunu (3102) başlatır, servis çalışanı kaydolup kabuğu önbelleğe
// alınca sunucuyu öldürür. (Playwright'ın setOffline'ı servis çalışanının ağını kapatmaz; bu yüzden sunucu kapatılır.)
const PORT = Number(process.env.E2E_OFFLINE_PORT || 3102);
const ORIGIN = `http://127.0.0.1:${PORT}`;
let server: ChildProcess | null = null;

test.use({ serviceWorkers: 'allow', baseURL: ORIGIN });

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${ORIGIN}/api/health`);
      if (res.ok) return;
    } catch {
      /* henüz kalkmadı */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('çevrimdışı sınama sunucusu açılmadı');
}

test.beforeAll(async () => {
  server = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'start', '-p', String(PORT), '-H', '127.0.0.1'], {
    env: {
      ...process.env,
      NEXT_DIST_DIR: '.next-e2e',
      NEXT_PUBLIC_SUPABASE_URL: FAKE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: FAKE_ANON_KEY,
      NEXT_PUBLIC_SITE_URL: ORIGIN,
    },
    stdio: 'ignore',
  });
  await waitForServer();
});

test.afterAll(() => {
  server?.kill('SIGKILL');
});

test('çevrimdışı: gezinti isteği önbellekteki yedek sayfaya düşer, kişisel sayfa önbelleğe alınmaz', async ({ page, context }) => {
  await signInAs(context, 'student');
  await page.goto('/ogrenci/profil');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // İlk sayfa kontrolsüzdür; çalışan clientsClaim ile devralana dek bekle.
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  // Yedek sayfa önceden önbelleğe alınmış olmalı (kurulum tamamlandı).
  await expect
    .poll(() =>
      page.evaluate(async () => {
        for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) if (new URL(req.url).pathname === '/cevrimdisi') return true;
        return false;
      }),
    )
    .toBe(true);

  // Kişisel sayfalar (HTML) hiçbir önbellekte yer almaz.
  const cachedPaths = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) for (const req of await (await caches.open(name)).keys()) out.push(new URL(req.url).pathname);
    return out;
  });
  expect(cachedPaths.filter((p) => p.startsWith('/ogrenci') || p.startsWith('/veli') || p.startsWith('/egitmen'))).toEqual([]);
  // Font ve token CSS'i (derleme çıktısı) önbellekte.
  expect(cachedPaths.some((p) => p.includes('/_next/static/') && p.endsWith('.css'))).toBe(true);

  server?.kill('SIGKILL');
  server = null;
  await new Promise((r) => setTimeout(r, 500));

  await page.goto('/ogrenci/notlarim');
  await expect(page.getByRole('heading', { name: 'İnternet bağlantın yok' })).toBeVisible();
  await expect(page.getByText('kişisel verilerin cihazında saklanmaz')).toBeVisible();
});
