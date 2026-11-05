import { expect, test } from '@playwright/test';
import { FAKE_URL } from './fixtures.mjs';
import { SCREEN_DIR, hasHorizontalOverflow, signInAs } from './helpers';

// Soru tarzları (P4-C, S13) uçtan uca, sahte Supabase (e2e/fake-styles.mjs): eğitmen çıkmış sınav yükler (Storage + ingest),
// öncelik listesini hesaplar ve onaylar, tarzı yeniden adlandırır, birleştirir, "5 soru üret" der; öğrenci Gelişim'de tek satır görür.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ request }) => {
  await request.get(`${FAKE_URL}/__styles/reset`);
});

test.describe('Eğitmen › Soru tarzları', () => {
  test('1440 px: özet, öncelik (hesapla → onayla), kartlar, yeniden adlandır, birleştir, 5 soru üret', async ({ page, context, request }) => {
    await signInAs(context, 'instructor');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/egitmen/soru-tarzlari');
    await expect(page.getByRole('heading', { level: 1, name: 'Soru tarzları · TYT Matematik' })).toBeVisible();
    await expect(page.getByText(/2023–2025 · 3 sınav yılı/)).toBeVisible();

    // öncelik: önce boş, hesapla, onayla
    const block = page.getByTestId('oncelikler');
    await expect(block.getByRole('heading', { name: 'Sıklık analizine göre öncelikler' })).toBeVisible();
    await expect(page.getByTestId('oncelik-bos')).toBeVisible();
    await block.getByRole('button', { name: 'Önceliği hesapla' }).click();
    await expect(block).toContainText('Onayını bekliyor');
    await expect(block).toContainText('Mutlak değerli eşitsizlikte aralık');
    await expect(block).toContainText('3/3 yıl');
    await block.getByRole('button', { name: /^Onayla$/ }).click();
    await expect(block).toContainText('Onaylandı');
    expect(await block.textContent()).not.toMatch(/%|tahmin|çıkacak/i);

    // kartlar
    const lib = page.getByTestId('tarz-kutuphanesi');
    const card = page.getByTestId('tarz-T-01');
    await expect(card).toContainText('3/3 yıl');
    await expect(card).toContainText('12 öğrenciden 7 kişi çözdü');
    await expect(page.getByTestId('tarz-T-03')).toContainText('Adı onay bekliyor');

    // yeniden adlandır
    await page.getByTestId('tarz-T-03').getByRole('button', { name: 'Düzenle' }).click();
    const name = page.getByTestId('tarz-T-03').getByLabel('Tarz adı');
    await name.fill('Basamak çözümleme');
    await page.getByTestId('tarz-T-03').getByRole('button', { name: 'Kaydet' }).click();
    await expect(page.getByTestId('tarz-T-03')).toContainText('Basamak çözümleme');
    await expect(page.getByTestId('tarz-T-03')).not.toContainText('Adı onay bekliyor');

    // 5 soru üret
    await card.getByRole('button', { name: '5 soru üret' }).click();
    await expect(lib).toContainText('5 soru üretmeye başladım');
    const st = (await (await request.get(`${FAKE_URL}/__styles`)).json()) as { requests: Array<{ count: number }> };
    expect(st.requests).toEqual([expect.objectContaining({ count: 5 })]);

    // tarz ekle
    await lib.getByRole('button', { name: 'Tarz ekle' }).click();
    await lib.getByLabel('Yeni tarzın adı').fill('Oran-orantı problemi');
    await lib.getByRole('button', { name: 'Ekle' }).click();
    await expect(page.getByText('Oran-orantı problemi')).toBeVisible();

    // birleştir: T-02 → T-01'e katılır
    await page.getByTestId('tarz-T-02').getByRole('button', { name: 'Birleştir' }).click();
    await page.getByTestId('tarz-T-02').getByLabel('Bu tarzı şuna kat').selectOption({ label: 'Mutlak değerli eşitsizlikte aralık' });
    await page.getByTestId('tarz-T-02').getByRole('button', { name: 'Birleştir' }).click();
    await expect(page.getByTestId('tarz-T-02')).toHaveCount(0);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/tarzlar-1440.png`, fullPage: true });
  });

  test('çıkmış sınav yükle: dosyalar Storage’a, kaynak alınır, tarzlara ayrılırken bilgi, sonra yeni taslak tarz', async ({ page, context }) => {
    await signInAs(context, 'instructor');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/egitmen/soru-tarzlari');
    await page.getByText('Çıkmış sınav yükle').first().click();
    const form = page.getByTestId('arsiv-yukle');
    await form.getByLabel('Sınav yılı').fill('2022');
    await form.getByLabel('Sınav türü').selectOption('osym');
    await form.getByTestId('arsiv-dosya').setInputFiles([
      { name: 'tyt-2022-1.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e') },
      { name: 'tyt-2022-2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 e2e 2') },
    ]);
    await expect(form.getByRole('list', { name: 'Seçilen dosyalar' })).toContainText('tyt-2022-1.pdf');
    await form.getByRole('button', { name: 'Yükle' }).click();
    await expect(form).toContainText('2022 sınavını aldım');
    await expect(page.getByText(/4 sınav yılı/)).toBeVisible();
    await expect(page.getByTestId('tarz-kutuphanesi')).toContainText('Yeni taslak tarz 2022', { timeout: 20_000 });
    await expect(page.getByTestId('tarz-kutuphanesi')).not.toContainText('tarzlara ayrılıyor');
  });

  test('390 px: taşma yok', async ({ page, context }) => {
    await signInAs(context, 'instructor');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/egitmen/soru-tarzlari');
    await expect(page.getByTestId('tarz-T-01')).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/tarzlar-390.png`, fullPage: true });
  });
});

test.describe('Öğrenci › Gelişim tarz satırı', () => {
  test('Konular katlısında tek satır "Tarz: 1/3 çözdün"; yüzde ve soru metni yok', async ({ page, context }) => {
    await signInAs(context, 'student');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ogrenci/gelisim');
    await page.getByTestId('konular').locator('summary').first().click();
    const row = page.getByTestId('tarz-satiri');
    await expect(row).toContainText('Tarz: 1/3 çözdün');
    await row.locator('summary').click();
    await expect(row).toContainText('3 çözdün, 1 doğru');
    await expect(row).toContainText('Bu tarzı hiç çözmedin');
    expect(await row.textContent()).not.toMatch(/%/);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/gelisim-tarz-390.png`, fullPage: true });
  });
});
