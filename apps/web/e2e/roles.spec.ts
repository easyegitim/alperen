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
    await page.goto('/veli/bildirimler');
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
    // Tek soru (mockup S01): arama + 6 çip; seçmeden devam edilemez. Akışın sonu e2e/bugun-test.spec.ts'te.
    await expect(page.getByRole('heading', { level: 1, name: 'Hangi sınava hazırlanıyorsun?' })).toBeVisible();
    for (const chip of ['TYT', 'AYT', 'LGS', 'KPSS', 'Üniversite dersi', 'Diğer']) await expect(page.getByRole('button', { name: chip, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Devam' })).toBeDisabled();
    await page.getByRole('button', { name: 'Üniversite dersi' }).click();
    await expect(page.getByLabel('Sınav veya ders ara')).toBeFocused();
    await expect(page.getByRole('button', { name: 'Devam' })).toBeDisabled();
    await page.getByLabel('Sınav veya ders ara').fill('Lineer Cebir');
    await expect(page.getByRole('button', { name: 'Devam' })).toBeEnabled();

    await page.goto('/hos-geldin?rol=veli');
    await page.getByLabel('Adın').fill('Ali Veli');
    await page.getByLabel('Davet kodu').fill('gi_gecersizkodgecersizkodgecersiz');
    await page.getByRole('button', { name: 'Daveti kabul et' }).click();
    await expect(page.getByText('Davet kodu bulunamadı ya da daha önce kullanılmış.')).toBeVisible();

    await page.goto('/hos-geldin?rol=egitmen');
    await expect(page.getByText('Eğitmen hesabını Öğrenmen ekibi açar', { exact: true })).toBeVisible();
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
      ['/ogrenci', 'Koçun ilk önerini hazırlıyor'],
      ['/ogrenci/gelisim/belgeler', 'Henüz belgen yok'],
      ['/ogrenci/gelisim/konular', 'Konu listen henüz boş'],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
  });

  test('öğrenci: eski yollar yeni yerlerine yönlenir', async ({ page, context }) => {
    await signInAs(context, 'student');
    for (const [from, to] of [
      ['/ogrenci/denemeler', '/ogrenci/gelisim/belgeler'],
      ['/ogrenci/notlarim', '/ogrenci/gelisim/belgeler'],
      ['/ogrenci/konu-haritasi', '/ogrenci/gelisim/konular'],
    ] as const) {
      await page.goto(from);
      await expect(page).toHaveURL(`${WEB_URL}${to}`);
    }
  });

  test('öğrenci: Gelişim hesap simgesiyle Profil’e, Koç sohbet karşılamasına açılır', async ({ page, context }) => {
    await signInAs(context, 'student');
    await page.goto('/ogrenci/gelisim');
    await page.getByRole('link', { name: /^Hesabın:/ }).click();
    await expect(page).toHaveURL(`${WEB_URL}/ogrenci/profil`);
    await page.goto('/ogrenci/koc');
    await expect(page.getByRole('heading', { level: 1, name: 'Koç' })).toBeVisible();
  });

  test('öğrenci: Sor sayfasında kamera yakalama bileşeni var', async ({ page, context }) => {
    await signInAs(context, 'student');
    await page.goto('/ogrenci/sor');
    await expect(page.getByRole('heading', { level: 1, name: 'Sor' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Fotoğraf çek/ })).toBeVisible();
  });

  test('veli: özet çocuğu ve bildirim kartını, bildirim ayarları kural anahtarlarını gösterir', async ({ page, context }) => {
    await signInAs(context, 'parent');
    await page.goto('/veli');
    await expect(page.getByRole('heading', { level: 1, name: 'Ayşe' })).toBeVisible();
    await expect(page.getByText('Haftalık özet hazır')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rapor iste' })).toBeVisible();
    await page.getByRole('link', { name: 'Bildirim ayarları' }).click();
    await expect(page).toHaveURL(`${WEB_URL}/veli/bildirimler`);
    await expect(page.getByRole('switch', { name: 'Haftalık özet' })).toBeVisible();
    await page.goto('/veli/raporlar');
    await expect(page).toHaveURL(`${WEB_URL}/veli`);
    await page.getByRole('link', { name: /^Hesabın/ }).click();
    await expect(page).toHaveURL(`${WEB_URL}/veli/ayarlar`);
    await expect(page.getByRole('heading', { name: 'Çocuk ekle' })).toBeVisible();
  });

  test('eğitmen: öğrenciler ve dersler listelenir; 9 konsol sayfasının hepsi açılır', async ({ page, context }) => {
    await signInAs(context, 'instructor');
    await page.goto('/egitmen');
    await expect(page.getByText('Ayşe Yılmaz')).toBeVisible();
    await page.goto('/egitmen/dersler');
    // Dersler (P5-C): yüklenen ders kayıtları; ders yokken boş durum ve açık "Ders yükle" formu (öğrenci/ders seçimi)
    await expect(page.getByText('Henüz ders yok')).toBeVisible();
    await expect(page.getByLabel('Ders', { exact: true })).toBeVisible();
    for (const slug of ['mufredatlar', 'soru-tarzlari', 'icerik', 'sinavlar', 'kuyruk', 'maliyet', 'ayarlar']) {
      const res = await page.goto(`/egitmen/${slug}`);
      expect(res?.status(), slug).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });
});
