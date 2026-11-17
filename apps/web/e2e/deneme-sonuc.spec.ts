import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { FAKE_URL } from './fixtures.mjs';
import { SCREEN_DIR, hasHorizontalOverflow, signInAs } from './helpers';

// Okul denemesi (P2-D): Yükle → bekleme ("sayfa 1/3") → büyük net + tek cümle → Detay (bölüm netleri, ısı haritası,
// yanlış/boş listesi) → "Nereye kadar geldim?" → rapor PDF görüntüleyici; veli Özet son rapor kartı. Sahte Supabase
// (e2e/fake-exam-result.mjs) worker'ı zamanlayıcıyla benzetir; gerçek hat supabase/tests/20-21 ve worker testlerindedir.

async function page_(buffer = 240) {
  return sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: buffer, g: buffer, b: 235 } } }).jpeg().toBuffer();
}

test.describe('Okul denemesi → sonuç → rapor', () => {
  test.beforeEach(async ({ context, page }) => {
    await signInAs(context, 'student');
    await page.setViewportSize({ width: 390, height: 844 });
    await fetch(`${FAKE_URL}/__examresult/key-source?value=inferred`);
  });

  test('yükle → bekleme → tek cümle → Detay → nereye kadar geldim → rapor PDF', async ({ page }) => {
    await page.goto('/ogrenci/yukle');
    await page.getByText('Okul denemesi', { exact: true }).click();
    const files = await Promise.all([240, 230, 220].map(async (v, i) => ({ name: `sayfa-${i + 1}.jpg`, mimeType: 'image/jpeg', buffer: await page_(v) })));
    await page.getByTestId('kamera-girisi').setInputFiles(files);
    await expect(page.getByText('3 sayfa hazır')).toBeVisible();
    await page.getByRole('button', { name: 'Gönder' }).click();

    // bekleme: maskot + tek satır, progress'ten "sayfa 3/3"
    await page.waitForURL(/\/ogrenci\/deneme\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Denemeni inceliyorum…' })).toBeVisible();
    await expect(page.getByTestId('bekleme-satiri')).toHaveText(/^sayfa [0-3]\/3$/);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/deneme-bekleme-390.png` });

    // sonuç (S05): büyük net + tek cümle + tek birincil "Devam et"
    await expect(page.getByTestId('buyuk-sayi').locator('[aria-hidden]')).toHaveText('2,75 net', { timeout: 20_000 });
    await expect(page.getByTestId('tek-cumle')).toHaveText('Okul denemesi: en çok Birinci dereceden denklemler konusunda zorlandın.');
    await expect(page.getByRole('link', { name: 'Devam et' })).toHaveAttribute('href', '/ogrenci');
    await expect(page.getByTestId('detay')).toBeHidden();
    await expect(page.getByText('%')).toHaveCount(0);
    await page.screenshot({ path: `${SCREEN_DIR}/deneme-sonuc-390.png`, fullPage: true });

    // Detay (katlı): bölüm netleri, ısı haritası (kelime bandı), yanlış/boş listesi, anahtar güveni tek satır
    await page.getByRole('button', { name: 'Detay' }).click();
    const detay = page.getByTestId('detay');
    await expect(detay).toBeVisible();
    await expect(detay.getByText('6 soruda 3 doğru, 1 yanlış, 2 boş.')).toBeVisible();
    await expect(page.getByTestId('anahtar-notu')).toContainText('çözerek çıkardım');
    await expect(page.getByTestId('bolum-netleri')).toContainText('Matematik');
    await expect(page.getByTestId('bolum-netleri')).toContainText('2,75 net');
    const heat = page.getByTestId('isi-haritasi');
    await expect(heat.locator('tr[data-band="low"]')).toContainText('1/3 · zayıf');
    await expect(heat.locator('tr[data-band="mid"]')).toContainText('2/3 · orta');
    const rows = page.getByTestId('yanlis-bos').getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText('Soru 3 · Yanlış');
    await expect(page.getByTestId('yanlis-bos').getByRole('link', { name: /Nereye kadar geldim\?/ })).toHaveCount(3);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/deneme-detay-390.png`, fullPage: true });

    // Yanlış soru: yaz → gönder → Detay'a döner, satır "Bakıyorum", sonra "Teşhisi gör"
    await rows.first().getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Soru 3' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hiç başlayamadım' })).toHaveCount(0);
    await page.screenshot({ path: `${SCREEN_DIR}/deneme-nereye-390.png` });
    await page.getByRole('button', { name: 'Yaz' }).click();
    await page.getByLabel('Nereye kadar geldin?').fill('Parantezi açarken eksiyi dağıtamadım.');
    await page.getByRole('button', { name: 'Gönder' }).click();
    await page.waitForURL(/\/ogrenci\/deneme\/[0-9a-f-]{36}\?detay=1$/);
    await expect(page.getByTestId('detay')).toBeVisible();
    await expect(rows.first()).toContainText('Bakıyorum');

    // Boş soru: "Süre yetmedi" tek dokunuş
    await rows.nth(1).getByRole('link').click();
    await expect(page.getByRole('button', { name: 'Hiç başlayamadım' })).toBeVisible();
    await page.getByRole('button', { name: 'Süre yetmedi' }).click();
    await page.waitForURL(/\?detay=1$/);
    await expect(rows.nth(1)).toContainText('Süre yetmedi');

    // rapor hazır olunca "Raporu aç (PDF)" (bekleme satırı yenilenir)
    const report = page.getByRole('link', { name: 'Raporu aç (PDF)' });
    await expect(report).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('rapor-bekliyor')).toHaveCount(0);

    // teşhis geldi: bekleyen satır kendiliğinden yenilenir ve "Teşhisi gör" olur
    await expect(page.getByTestId('yanlis-bos').getByRole('link', { name: /Teşhisi gör/ })).toBeVisible({ timeout: 15_000 });

    // PDF görüntüleyici (S09)
    await page.getByRole('link', { name: 'Raporu aç (PDF)' }).click();
    await page.waitForURL(/\/ogrenci\/belge\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: /Deneme raporu/ })).toBeVisible();
    await expect(page.getByTestId('belge-goruntuleyici').locator('canvas').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'İndir / Paylaş' })).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/deneme-rapor-390.png` });

    // Belgelerim listesi (list_my_documents) aynı belgeyi görüntüleyiciye bağlar; eski adres yönlenir
    await page.goto('/ogrenci/gelisim/belgeler');
    await expect(page.getByRole('link', { name: /Deneme raporu/ })).toBeVisible();
    const href = await page.getByRole('link', { name: /Deneme raporu/ }).first().getAttribute('href');
    expect(href).toMatch(/^\/ogrenci\/belge\/[0-9a-f-]{36}$/);
    await page.goto(href!.replace('/ogrenci/belge/', '/ogrenci/gelisim/belgeler/'));
    await page.waitForURL(/\/ogrenci\/belge\/[0-9a-f-]{36}$/);
  });

  test('analiz düşerse tek cümle ve Yeniden yükle', async ({ page }) => {
    await fetch(`${FAKE_URL}/__examresult/fail-next`);
    await page.goto('/ogrenci/yukle');
    await page.getByText('Okul denemesi', { exact: true }).click();
    await page.getByTestId('dosya-girisi').setInputFiles({ name: 'sayfa.jpg', mimeType: 'image/jpeg', buffer: await page_() });
    await page.getByRole('button', { name: 'Gönder' }).click();
    await page.waitForURL(/\/ogrenci\/deneme\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('tek-cumle')).toHaveText('Denemeni okuyamadım.', { timeout: 15_000 });
    await expect(page.getByRole('link', { name: 'Yeniden yükle' })).toHaveAttribute('href', '/ogrenci/yukle');
  });

  test('bilinmeyen deneme bağlantısı boş durum çizer', async ({ page }) => {
    await page.goto('/ogrenci/deneme/00000000-0000-4000-8000-00000000dead');
    await expect(page.getByRole('heading', { name: 'Bu sonucu bulamadım' })).toBeVisible();
  });
});

// Sahte durumu sonraki dosyalara bırakma (ör. roles.spec "Henüz belgen yok" boş durumu)
test.afterAll(async () => {
  await fetch(`${FAKE_URL}/__examresult/cleanup`);
});

test.describe('Veli: son rapor', () => {
  test('Özet son rapor kartı aynı görüntüleyiciyi açar', async ({ context, page }) => {
    await signInAs(context, 'parent');
    await page.setViewportSize({ width: 390, height: 844 });
    // kendi kendine yeten: rapor yoksa öğrenci olarak bir deneme gönderilir, rapor belgesi oluşana dek beklenir
    type Sessions = { sessions: { report_document_id: string | null }[] };
    const reportReady = async () => ((await (await fetch(`${FAKE_URL}/__examresult`)).json()) as Sessions).sessions.some((x) => x.report_document_id);
    if (!(await reportReady())) {
      await signInAs(context, 'student');
      await page.goto('/ogrenci/yukle');
      await page.getByText('Okul denemesi', { exact: true }).click();
      await page.getByTestId('dosya-girisi').setInputFiles({ name: 'sayfa.jpg', mimeType: 'image/jpeg', buffer: await page_() });
      await page.getByRole('button', { name: 'Gönder' }).click();
      await page.waitForURL(/\/ogrenci\/deneme\/[0-9a-f-]{36}$/);
      await expect.poll(reportReady, { timeout: 40_000 }).toBe(true);
      await signInAs(context, 'parent');
    }
    await page.goto('/veli');
    const card = page.getByTestId('son-rapor');
    await expect(card).toContainText('Deneme raporu');
    await card.click();
    await page.waitForURL(/\/veli\/rapor\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('belge-goruntuleyici').locator('canvas').first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${SCREEN_DIR}/veli-rapor-390.png` });
  });
});
