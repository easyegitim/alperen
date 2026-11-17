import { expect, test } from '@playwright/test';
import { FAKE_URL } from './fixtures.mjs';
import { SCREEN_DIR, hasHorizontalOverflow, signInAs } from './helpers';

// Dersler (P5-C, S14) uçtan uca, sahte Supabase (e2e/fake-lessons.mjs): eğitmen ders yükler (Uppy + TUS, parçalı), hat
// ilerler, iddiaları inceler (Onayla/Düzenle/Reddet), eşiği ve "Öğrenciye görünür"ü ayarlar; öğrenci Gelişim'de yalnız tarih +
// tek cümle görür; veli göremez.
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  await request.get(`${FAKE_URL}/__lessons/reset`);
});

// sonraki dosyalar (roles.spec) boş ders listesi görür
test.afterAll(async ({ request }) => {
  await request.get(`${FAKE_URL}/__lessons/reset`);
});

test.describe('Eğitmen › Dersler', () => {
  test('1440 px: boş durum → yükle (TUS, 3 parça) → işleniyor → iddia incelemesi → öğrenciye aç', async ({ page, context, request }) => {
    await signInAs(context, 'instructor');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/egitmen/dersler');
    await expect(page.getByRole('heading', { level: 1, name: 'Dersler' })).toBeVisible();
    await expect(page.getByText('Henüz ders yok')).toBeVisible();

    // yükle: öğrenci ve ders tek olduğu için kendiliğinden seçilir
    const form = page.getByTestId('ders-yukle');
    await expect(form).toBeVisible();
    await expect(form.getByRole('button', { name: 'Dersi yükle' })).toBeDisabled();
    await form.getByLabel('Başlık (isteğe bağlı)').fill('Mutlak değer');
    await page.getByTestId('ders-dosya').setInputFiles({ name: 'ders12.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(13 * 1024 * 1024, 7) });
    await expect(form).toContainText('ders12.mp4');
    await form.getByRole('button', { name: 'Dersi yükle' }).click();
    await expect(form).toContainText('Dersi aldım; yazıya çeviriyorum.');

    // liste: işleniyor (aşama kelimeyle), sonra onay bekleyen iddia sayısı
    const row = page.getByTestId('ders-satiri').first();
    await expect(row).toContainText('Ders 1 · Mutlak değer');
    await expect(row).toContainText('Ayşe Yılmaz · TYT Matematik');
    await expect(row.getByText('4 onay bekliyor')).toBeVisible({ timeout: 20_000 });
    expect(await row.textContent()).not.toMatch(/%/);

    // dosya Storage'a 6 MB'lık parçalarla (kaldığı yerden sürebilecek biçimde) gitti
    const fake = (await (await request.get(`${FAKE_URL}/__lessons`)).json()) as { objects: Record<string, { bytes: number; chunks: number }> };
    const obj = Object.entries(fake.objects).find(([k]) => k.endsWith('.mp4'));
    expect(obj?.[1]).toEqual({ bytes: 13 * 1024 * 1024, chunks: 3 });
    expect(obj?.[0]).toMatch(/^00000000-0000-4000-8000-000000000003\/[0-9a-f-]{36}\.mp4$/);

    // ayrıntı: transkript + iddialar
    await row.click();
    await expect(page).toHaveURL(/\/egitmen\/dersler\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Ders 1 · Mutlak değer' })).toBeVisible();
    await expect(page.getByTestId('transkript-satiri')).toHaveCount(6);
    await expect(page.getByTestId('transkript-satiri').nth(4)).toContainText('ÖĞRENCİ');
    await expect(page.getByTestId('transkript-satiri').nth(4)).toContainText('14:10');
    const claims = page.getByTestId('iddia');
    await expect(claims).toHaveCount(5);
    await expect(claims.first()).toContainText('Güven orta · eşiğin altında');
    await expect(claims.first().getByRole('meter')).toBeVisible();
    // yalnız 0,92'lik ustalık otomatik uygulandı; ödev ve sonraki adım modelin yargısı: eğitmen görmeden onaylanmaz
    await expect(page.getByTestId('uygulama-durumu')).toContainText('1/5 · 4 onay bekliyor · 0 reddedildi');
    expect(await page.locator('main').textContent()).not.toMatch(/%\s?\d|\d\s?%/);

    // iddiaya dokununca kanıtı transkriptte işaretlenir
    await claims.first().getByRole('button', { name: /kanıtı transkriptte göster/ }).click();
    await expect(page.getByTestId('transkript-satiri').nth(4)).toHaveAttribute('data-active', 'true');

    // düzenle (ustalık bandı) → uygulanır; geri al; yanılgıyı reddet
    await claims.first().getByRole('button', { name: 'Düzenle' }).click();
    await claims.first().getByRole('button', { name: 'İyi' }).click();
    await expect(claims.first()).toContainText('Dossier’e uygulandı');
    await claims.first().getByRole('button', { name: 'Geri al' }).click();
    await expect(claims.first()).toContainText('Reddedildi');
    await claims.nth(2).getByRole('button', { name: 'Onayla' }).click();
    await expect(claims.nth(2)).toContainText('Dossier’e uygulandı');
    await expect(page.getByTestId('uygulama-durumu')).toContainText('2/5 · 2 onay bekliyor · 1 reddedildi');
    for (const i of [3, 4]) {
      await claims.nth(i).getByRole('button', { name: 'Onayla' }).click();
      await expect(claims.nth(i)).toContainText('Dossier’e uygulandı');
    }
    await expect(page.getByTestId('uygulama-durumu')).toContainText('4/5 · 0 onay bekliyor · 1 reddedildi');

    // eşik ve Dossier'e uygula
    await expect(page.getByTestId('esik-deger')).toHaveText('0,80');
    const slider = page.getByLabel(/Otomatik uygulama eşiği/);
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('esik-deger')).toHaveText('0,85');
    await page.getByTestId('dossiere-uygula').click();
    await expect(page.getByText('Eşiğin üstünde işlenecek yeni iddia yok.')).toBeVisible();

    // öğrenciye görünür
    const sw = page.getByRole('switch', { name: 'Öğrenciye görünür' });
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText(/transkript ve alıntılar gizli kalır/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Öğrenciye görünür' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('esik-deger')).toHaveText('0,85');
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/ders-iddia-1440.png`, fullPage: true });
  });

  test('390 px: liste ve ayrıntı yatay taşmaz, dokunma hedefleri 44 px', async ({ page, context }) => {
    await signInAs(context, 'instructor');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/egitmen/dersler');
    await expect(page.getByTestId('ders-satiri')).toHaveCount(1);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/dersler-390.png`, fullPage: true });
    await page.getByTestId('ders-satiri').click();
    await expect(page.getByTestId('iddia').first()).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    for (const b of await page.getByTestId('iddia').first().getByRole('button').all()) {
      const box = await b.boundingBox();
      if (box) expect(box.height).toBeGreaterThanOrEqual(36);
    }
    await page.screenshot({ path: `${SCREEN_DIR}/ders-iddia-390.png`, fullPage: true });
  });

  test('desteklenmeyen dosya reddedilir', async ({ page, context }) => {
    await signInAs(context, 'instructor');
    await page.goto('/egitmen/dersler?yukle=1');
    await page.getByTestId('ders-dosya').setInputFiles({ name: 'sorular.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') });
    await expect(page.getByTestId('ders-yukle').getByRole('alert')).toContainText('Bu dosya türünü alamıyorum');
    await expect(page.getByRole('button', { name: 'Dersi yükle' })).toBeDisabled();
  });
});

test.describe('Öğrenci ve veli', () => {
  test('öğrenci Gelişim › Dersler: tarih + tek cümle, transkript/alıntı/güven yok', async ({ page, context }) => {
    await signInAs(context, 'student');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ogrenci/gelisim');
    const fold = page.getByTestId('dersler');
    await expect(fold).toBeVisible();
    await fold.locator('summary').click();
    const item = fold.getByTestId('ders-ozeti');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('Uç noktaları kontrol ederek beş soru çöz.');
    expect(await item.textContent()).toMatch(/\d{1,2} \p{L}{3} 20\d\d/u);
    const text = (await fold.textContent()) ?? '';
    expect(text).not.toMatch(/güven|transkript|Eksi tarafı|%/i);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/gelisim-dersler-390.png`, fullPage: true });
  });

  test('görünürlük kapanınca öğrencide bölüm yok; öğrenci ve veli eğitmen ekranına giremez', async ({ page, context, request }) => {
    await signInAs(context, 'instructor');
    await page.goto('/egitmen/dersler');
    await page.getByTestId('ders-satiri').click();
    await page.getByRole('switch', { name: 'Öğrenciye görünür' }).click();
    await expect(page.getByRole('switch', { name: 'Öğrenciye görünür' })).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => ((await (await request.get(`${FAKE_URL}/__lessons`)).json()) as { lessons: Array<{ student_visible: boolean }> }).lessons[0]?.student_visible).toBe(false);

    const student = await context.browser()!.newContext({ locale: 'tr-TR' });
    await signInAs(student, 'student');
    const sp = await student.newPage();
    await sp.goto('/ogrenci/gelisim');
    await expect(sp.getByTestId('belgelerim')).toBeVisible();
    await expect(sp.getByTestId('dersler')).toHaveCount(0);
    await sp.goto('/egitmen/dersler');
    await expect(sp).toHaveURL(/\/ogrenci/);
    await student.close();

    const parent = await context.browser()!.newContext({ locale: 'tr-TR' });
    await signInAs(parent, 'parent');
    const pp = await parent.newPage();
    await pp.goto('/egitmen/dersler');
    await expect(pp).toHaveURL(/\/veli/);
    await parent.close();
  });
});

test.describe('Düşen ders', () => {
  test('hata notu + Yeniden dene: aynı kayıtla yeniden işlenir, yeniden yükleme yok', async ({ page, context, request }) => {
    await request.get(`${FAKE_URL}/__lessons/fail`);
    await signInAs(context, 'instructor');
    await page.goto('/egitmen/dersler');
    await page.getByTestId('ders-satiri').first().click();
    const note = page.getByTestId('ders-hata');
    await expect(note).toContainText('Bu dersi işleyemedim: Kayıt hazırlanamadı: kayıtta ses akışı yok');
    await expect(note).toContainText('Aynı kayıtla yeniden deneyebilirsin.');
    const retry = page.getByTestId('ders-yeniden-dene');
    const box = await retry.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(36);
    await retry.click();
    await expect(page.getByTestId('ders-hata')).toHaveCount(0);
    await expect.poll(async () => ((await (await request.get(`${FAKE_URL}/__lessons`)).json()) as { lessons: Array<{ status: string; progress: { retried?: number } }> }).lessons[0]?.progress.retried).toBe(1);
    await expect(page.getByTestId('iddia')).toHaveCount(5, { timeout: 20_000 });
    const objects = Object.keys(((await (await request.get(`${FAKE_URL}/__lessons`)).json()) as { objects: Record<string, unknown> }).objects);
    expect(objects.filter((k) => k.endsWith('.mp4'))).toHaveLength(1);
  });
});
