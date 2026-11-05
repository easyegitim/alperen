import { expect, test } from '@playwright/test';
import { FAKE_URL } from './fixtures.mjs';
import { SCREEN_DIR, hasHorizontalOverflow, signInAs } from './helpers';

// Akış 5 uçtan uca (sahte LLM + sahte Supabase, e2e/fake-documents.mjs): Koç'ta "rasyonel sayılar notu istiyorum" →
// sohbette tek cümle + ince durum kartı → hazır → Bugün kartı → belge sayfası; "40 soruluk deneme hazırla" → eğitmen
// incelemesi → Onayla → öğrenciye "Denemen hazır" + "Çöz".
// Dosya adı bilerek 'z-': Koç'un süreç içi sohbet deposu süreç boyunca tek sohbet tutar; bu dosya en sona kalır ki
// koc.spec.ts'in "boş sohbet karşılaması" beklentisini bozmasın.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ request }) => {
  await request.get(`${FAKE_URL}/__documents/cleanup`);
});

test.describe('Koç → belge', () => {
  test('not isteği: durum kartı → hazır → Aç; Bugün kartı; Belgelerim kelimeyle', async ({ page, context }) => {
    await signInAs(context, 'student');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ogrenci/koc');
    await page.getByLabel('Koça yaz').fill('rasyonel sayılar notu istiyorum');
    await page.getByRole('button', { name: 'Gönder' }).click();
    const log = page.getByRole('log', { name: 'Öğrenmen ile sohbet' });
    await expect(log.getByText(/Hazır olunca Bugün’de görürsün/)).toBeVisible();
    const card = page.getByTestId('belge-istek').last();
    await expect(card).toContainText('Hazırlıyorum… Bugün’de görürsün');
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/koc-belge-bekleme-390.png`, fullPage: true });
    await expect(card).toContainText('Notun hazır', { timeout: 20_000 });
    await page.screenshot({ path: `${SCREEN_DIR}/koc-belge-hazir-390.png`, fullPage: true });

    // yeniden yükleme: kart sohbet geçmişinde kalır
    await page.reload();
    await expect(page.getByTestId('belge-istek').last()).toContainText('Notun hazır');

    // Bugün: document_ready kartı (S02) → belge sayfası
    await page.goto('/ogrenci');
    const notice = page.getByRole('button', { name: /Aç: Rasyonel sayılar notun hazır/ });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('PDF');
    await page.screenshot({ path: `${SCREEN_DIR}/bugun-belge-390.png`, fullPage: true });
    await notice.click();
    await expect(page).toHaveURL(/\/ogrenci\/belge\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('belge-goruntuleyici')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Çöz' })).toHaveCount(0);

    // Belgelerim (Gelişim › katlı): durum kelimesiyle
    await page.goto('/ogrenci/gelisim/belgeler');
    const list = page.getByTestId('belge-listesi');
    await expect(list).toContainText('Rasyonel sayılar');
    await expect(list).toContainText('Hazır');
  });

  test('deneme isteği: İncelemede → eğitmen onayı → Denemen hazır, Çöz', async ({ page, browser, context }) => {
    await signInAs(context, 'student');
    await page.goto('/ogrenci/koc');
    await page.getByLabel('Koça yaz').fill('40 soruluk deneme hazırla');
    await page.getByRole('button', { name: 'Gönder' }).click();
    // bellek deposu süreç boyunca tek sohbet tutar: önceki testin kartı da geçmişte; yeni kart sonda
    const card = page.getByTestId('belge-istek').last();
    await expect(card).toContainText('Hocan inceliyor', { timeout: 20_000 });

    // öğrenci Belgelerim'de "İncelemede" görür, açamaz
    await page.goto('/ogrenci/gelisim/belgeler');
    await expect(page.getByTestId('belge-listesi')).toContainText('İncelemede');
    // (listede başka belgeler olabilir — örn. önceki dosyaların deneme raporu: yalnız bu satırın bağlantısı olmamalı)
    await expect(page.getByTestId('belge-listesi').getByRole('listitem').filter({ hasText: 'İncelemede' }).getByRole('link')).toHaveCount(0);

    // eğitmen: kuyruk → özet kelimeyle → Onayla
    const ictx = await browser.newContext({ locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
    const ipage = await ictx.newPage();
    await signInAs(ictx, 'instructor');
    await ipage.setViewportSize({ width: 1440, height: 900 });
    await ipage.goto('/egitmen/icerik');
    await expect(ipage.getByRole('heading', { level: 1, name: 'İçerik' })).toBeVisible();
    const queue = ipage.getByTestId('inceleme-kuyrugu');
    await expect(queue).toBeVisible();
    await expect(ipage.getByTestId('dogrulama')).toContainText('Çözümler (SymPy): geçti');
    await expect(ipage.getByTestId('belge-goruntuleyici')).toBeVisible();
    expect(await hasHorizontalOverflow(ipage)).toBe(false);
    await ipage.screenshot({ path: `${SCREEN_DIR}/egitmen-icerik-1440.png`, fullPage: true });
    await ipage.getByLabel(/Not/).fill('Şekiller net.');
    await ipage.getByRole('button', { name: 'Onayla' }).click();
    await expect(ipage.getByText('İncelenecek içerik yok')).toBeVisible();
    await ictx.close();

    // öğrenci: kart hazır, Bugün kartı, belge sayfasında "Çöz"
    await page.goto('/ogrenci/koc');
    await expect(page.getByTestId('belge-istek').last()).toContainText('Denemen hazır', { timeout: 20_000 });
    await page.goto('/ogrenci');
    await page.getByRole('button', { name: /Aç: Denemen hazır/ }).click();
    await expect(page).toHaveURL(/\/ogrenci\/belge\//);
    await expect(page.getByRole('link', { name: 'Çöz' })).toHaveAttribute('href', /\/ogrenci\/sinav\/[0-9a-f-]{36}$/);
  });

  test('sıradan soru belge açmaz', async ({ page, context, request }) => {
    await signInAs(context, 'student');
    await page.goto('/ogrenci/koc');
    const before = await page.getByTestId('belge-istek').count();
    await page.getByLabel('Koça yaz').fill('Kesirleri nasıl toplarım?');
    await page.getByRole('button', { name: 'Gönder' }).click();
    await expect(page.getByRole('log', { name: 'Öğrenmen ile sohbet' }).getByText(/Sahte yanıt/).last()).toBeVisible();
    await expect(page.getByTestId('belge-istek')).toHaveCount(before);
    const state = (await (await request.get(`${FAKE_URL}/__documents`)).json()) as { requests: unknown[] };
    expect(state.requests).toHaveLength(0);
  });

  test('öğrenci eğitmen kuyruğuna giremez', async ({ page, context }) => {
    await signInAs(context, 'student');
    await page.goto('/egitmen/icerik');
    await expect(page).toHaveURL(/\/ogrenci/);
  });
});
