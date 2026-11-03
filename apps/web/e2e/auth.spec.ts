import { expect, test } from '@playwright/test';
import { OTP_CODE, USERS, WEB_URL } from './fixtures.mjs';

test.describe('giriş', () => {
  test('giriş sayfası Türkçe ve erişilebilir biçimde çizilir', async ({ page }) => {
    await page.goto('/giris');
    await expect(page).toHaveTitle('Giriş yap · Öğrenmen');
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('heading', { level: 1, name: 'Giriş yap' })).toBeVisible();
    await expect(page.getByLabel('E-posta adresin')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kod gönder' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Google ile devam et' })).toBeVisible();
    // Marka ve PWA bildirimi
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#0030a2');
    // Ünlem ve emoji yok (marka kuralı)
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/!/);
  });

  test('oturumsuz kullanıcı korumalı sayfada giriş sayfasına yönlenir ve dönüş yolu korunur', async ({ page }) => {
    await page.goto('/ogrenci/notlarim');
    await expect(page).toHaveURL(`${WEB_URL}/giris?next=${encodeURIComponent('/ogrenci/notlarim')}`);
    await page.goto('/egitmen');
    await expect(page).toHaveURL(/\/giris\?next=%2Fegitmen$/);
  });

  test('geçersiz e-posta alan hatasıyla reddedilir', async ({ page }) => {
    await page.goto('/giris');
    await page.getByLabel('E-posta adresin').fill('yanlis');
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await expect(page.getByText('Geçerli bir e-posta adresi yaz.')).toBeVisible();
  });

  test('e-posta kodu akışı: kod gönder, yanlış kod hata verir, doğru kod rol ana sayfasına götürür', async ({ page }) => {
    await page.goto('/giris');
    await page.getByLabel('E-posta adresin').fill(USERS.student.email);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await expect(page.getByText('adresine bir kod gönderdik')).toBeVisible();

    await page.getByLabel('E-posta kodu').fill('000000');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(page.getByText('Kod geçersiz ya da süresi dolmuş.')).toBeVisible();

    await page.getByLabel('E-posta kodu').fill(OTP_CODE);
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(page).toHaveURL(`${WEB_URL}/ogrenci`);
    await expect(page.getByRole('heading', { level: 1, name: 'Merhaba, Ayşe' })).toBeVisible();
  });

  test('dışarı yönlendiren next parametresi yok sayılır', async ({ page }) => {
    await page.goto('/giris?next=//kotu.example');
    await page.getByLabel('E-posta adresin').fill(USERS.parent.email);
    await page.getByRole('button', { name: 'Kod gönder' }).click();
    await page.getByLabel('E-posta kodu').fill(OTP_CODE);
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await expect(page).toHaveURL(`${WEB_URL}/veli`);
  });

  test('çıkış yapınca giriş sayfasına dönülür', async ({ page, context }) => {
    const { signInAs } = await import('./helpers');
    await signInAs(context, 'student');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ogrenci/profil');
    await page.getByRole('button', { name: 'Çıkış yap' }).click();
    await expect(page).toHaveURL(`${WEB_URL}/giris`);
  });
});

test.describe('herkese açık uçlar', () => {
  test('sağlık ucu', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: 'ok', service: 'ogrenmen-web', supabase: 'configured' });
    expect(res.headers()['cache-control']).toContain('no-store');
  });

  test('PWA bildirimi: ad, tema rengi ve simgeler', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.status()).toBe(200);
    const manifest = await res.json();
    expect(manifest).toMatchObject({ name: 'Öğrenmen', short_name: 'Öğrenmen', theme_color: '#0030a2', display: 'standalone', lang: 'tr', start_url: '/' });
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const icon of manifest.icons) {
      const r = await request.get(icon.src);
      expect(r.status(), icon.src).toBe(200);
      expect(r.headers()['content-type']).toContain('image/png');
    }
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  });

  test('servis çalışanı derlendi ve çevrimdışı sayfa oturumsuz açılır', async ({ request, page }) => {
    const sw = await request.get('/sw.js');
    expect(sw.status()).toBe(200);
    expect(sw.headers()['content-type']).toContain('javascript');
    expect(sw.headers()['cache-control']).toContain('no-cache');
    expect(await sw.text()).toContain('/cevrimdisi');
    await page.goto('/cevrimdisi');
    await expect(page.getByRole('heading', { name: 'İnternet bağlantın yok' })).toBeVisible();
  });
});
