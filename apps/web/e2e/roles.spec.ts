import { expect, test } from '@playwright/test';
import { WEB_URL } from './fixtures.mjs';
import { signInAs } from './helpers';

test.describe('rol yönlendirmesi (sahte oturum)', () => {
  test('öğrenci: / ve /giris kendi sayfasına, başka rolün alanı kendi sayfasına yönlenir', async ({ page, context }) => {
    await signInAs(context, 'student');
    await page.goto('/');
    await expect(page).toHaveURL(`${WEB_URL}/ogrenci`);
    await page.goto('/giris');
    await expect(page).toHaveURL(`${WEB_URL}/ogrenci`);
    await page.goto('/veli/raporlar');
    await expect(page).toHaveURL(`${WEB_URL}/ogrenci`);
    await page.goto('/egitmen/maliyet');
    await expect(page).toHaveURL(`${WEB_URL}/ogrenci`);
  });

  test('veli', async ({ page, context }) => {
    await signInAs(context, 'parent');
    await page.goto('/');
    await expect(page).toHaveURL(`${WEB_URL}/veli`);
    await page.goto('/ogrenci/profil');
    await expect(page).toHaveURL(`${WEB_URL}/veli`);
    await page.goto('/egitmen');
    await expect(page).toHaveURL(`${WEB_URL}/veli`);
  });

  test('eğitmen', async ({ page, context }) => {
    await signInAs(context, 'instructor');
    await page.goto('/');
    await expect(page).toHaveURL(`${WEB_URL}/egitmen`);
    await page.goto('/veli');
    await expect(page).toHaveURL(`${WEB_URL}/egitmen`);
    await page.goto('/ogrenci/sor');
    await expect(page).toHaveURL(`${WEB_URL}/egitmen`);
  });

  test('profili olmayan yeni kullanıcı rol seçimine gider', async ({ page, context }) => {
    await signInAs(context, 'newcomer');
    await page.goto('/');
    await expect(page).toHaveURL(`${WEB_URL}/hos-geldin`);
    await expect(page.getByRole('heading', { level: 1, name: 'Hoş geldin' })).toBeVisible();
    await page.goto('/ogrenci');
    await expect(page).toHaveURL(`${WEB_URL}/hos-geldin`);

    await page.getByRole('link', { name: 'Öğrenciyim' }).click();
    await expect(page.getByLabel('Adın')).toBeVisible();
    await expect(page.getByLabel('Sınıfın')).toBeVisible();
    await page.getByRole('button', { name: 'Başla' }).click();
    await expect(page.getByText('Adın 2 ile 60 karakter arasında olmalı.')).toBeVisible();

    await page.goto('/hos-geldin?rol=veli');
    await page.getByLabel('Adın').fill('Ali Veli');
    await page.getByLabel('Davet kodu').fill('gi_gecersizkodgecersizkodgecersiz');
    await page.getByRole('button', { name: 'Daveti kabul et' }).click();
    await expect(page.getByText('Davet kodu bulunamadı ya da daha önce kullanılmış.')).toBeVisible();

    await page.goto('/hos-geldin?rol=egitmen');
    await expect(page.getByText('Eğitmen hesapları davetle açılır')).toBeVisible();
  });
});

test.describe('sayfa içerikleri', () => {
  test('öğrenci: Profil > Hafıza RLS ile gelen dosyaları listeler', async ({ page, context }) => {
    await signInAs(context, 'student');
    await page.goto('/ogrenci/profil/hafiza');
    await expect(page.getByRole('heading', { level: 1, name: 'Hafıza' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Seni nasıl tanıyorum' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tekrar eden hatalar' })).toBeVisible();
    await expect(page.getByText('Eksi işaretini dağıtırken')).toBeVisible();
  });

  test('öğrenci: boş durum sayfaları maskotlu ve Türkçe', async ({ page, context }) => {
    await signInAs(context, 'student');
    for (const [path, heading] of [
      ['/ogrenci/denemeler', 'Henüz deneme yok'],
      ['/ogrenci/notlarim', 'Henüz notun yok'],
      ['/ogrenci/konu-haritasi', 'Konu haritan henüz boş'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
  });

  test('öğrenci: Sor sayfasında kamera yakalama bileşeni var', async ({ page, context }) => {
    await signInAs(context, 'student');
    await page.goto('/ogrenci/sor');
    await expect(page.getByRole('heading', { level: 1, name: 'Sor' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Fotoğraf çek/ })).toBeVisible();
  });

  test('veli: özet çocuğu, bildirimler kayıtlı bildirimi gösterir', async ({ page, context }) => {
    await signInAs(context, 'parent');
    await page.goto('/veli');
    await expect(page.getByText('Ayşe Yılmaz')).toBeVisible();
    await page.goto('/veli/bildirimler');
    await expect(page.getByText('Haftalık özet hazır')).toBeVisible();
    await page.goto('/veli/ayarlar');
    await expect(page.getByRole('heading', { name: 'Çocuk ekle' })).toBeVisible();
  });

  test('eğitmen: öğrenciler ve dersler listelenir; 9 konsol sayfasının hepsi açılır', async ({ page, context }) => {
    await signInAs(context, 'instructor');
    await page.goto('/egitmen');
    await expect(page.getByText('Ayşe Yılmaz')).toBeVisible();
    await page.goto('/egitmen/dersler');
    await expect(page.getByText('TYT Matematik')).toBeVisible();
    for (const slug of ['mufredatlar', 'soru-tarzlari', 'icerik', 'sinavlar', 'kuyruk', 'maliyet', 'ayarlar']) {
      const res = await page.goto(`/egitmen/${slug}`);
      expect(res?.status(), slug).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });
});
