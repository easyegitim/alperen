import { expect, test } from '@playwright/test';
import { FAKE_URL } from './fixtures.mjs';
import { SCREEN_DIR, hasHorizontalOverflow, signInAs } from './helpers';

// Veli uçtan uca (P6-C; sahte Supabase e2e/fake-parent.mjs + sahte LLM + süreç içi sohbet deposu): Özet (tek cümle, üç sayı,
// bildirim kartı) → Soru sor (sohbet turu, araç çağrısı) → Rapor iste (tür çipleri, günlük sınır) → bildirim ayarları.
// Davet → ilk Özet: davet.spec.ts. Gerçek yetki/RLS/sınır: supabase/tests/30–32 ve test/parent.db.test.ts.

interface FakeParent {
  requests: Array<{ kind: string; params: Record<string, unknown> }>;
  rules: Array<[string, Array<[string, boolean]>]>;
  channels: Array<[string, Array<[string, string[]]>]>;
}
const fake = async (): Promise<FakeParent> => (await (await fetch(`${FAKE_URL}/__parent`)).json()) as FakeParent;

test.describe('veli', () => {
  test.beforeEach(async ({ page, context }) => {
    await fetch(`${FAKE_URL}/__parent/reset`);
    await signInAs(context, 'parent');
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('Özet: tek cümle, üç sayı, bildirim okundu; Soru sor → sohbet turu; çipten haftalık rapor', async ({ page }) => {
    await page.goto('/veli');
    await expect(page.getByTestId('veli-durum')).toHaveText('Ayşe bu hafta 4,5 saat çalıştı; matematikte ilerliyor, Türkçe’de tekrar gerekiyor.');
    const stats = page.getByRole('group', { name: 'Bu hafta' }).or(page.locator('dl[aria-label="Bu hafta"]'));
    await expect(stats).toContainText('4,5');
    await expect(stats).toContainText('38');
    await expect(stats).toContainText('27,5');
    expect(await page.getByText('%').count()).toBe(0);
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // bildirim kartı: Okudum
    await expect(page.getByTestId('bildirim')).toHaveCount(1);
    await page.getByRole('button', { name: 'Okudum' }).click();
    await expect(page.getByTestId('bildirim')).toHaveCount(0);

    // Soru sor → Sohbet
    await page.getByRole('link', { name: 'Soru sor' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sohbet' })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0); // mod seçici yok
    const box = page.getByLabel('Öğrenmen’e sorun');
    await box.fill('Bu hafta ne çalıştı?');
    const replied = page.waitForResponse((r) => r.url().endsWith('/api/parent-chat') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Gönder' }).click();
    expect((await replied).headers()['content-type']).toContain('text/event-stream');
    const log = page.getByRole('log');
    await expect(log).toContainText('Bu hafta yaklaşık 4,5 saat çalıştı ve 38 soru çözdü', { timeout: 20_000 });
    await expect(log).toContainText('Bu hafta ne çalıştı?');
    await page.screenshot({ path: `${SCREEN_DIR}/veli-sohbet-390.png` });

    // çip yok (mockup S10b); rapor serbest metinle istenir -> ajan request_report çağırır
    await expect(page.getByRole('list', { name: 'Rapor iste' })).toHaveCount(0);
    await box.fill('Haftalık rapor istiyorum.');
    await page.getByRole('button', { name: 'Gönder' }).click();
    await expect(log).toContainText('Haftalık raporu hazırlatıyorum', { timeout: 20_000 });
    await expect(page.getByTestId('rapor-istendi')).toContainText('Haftalık rapor istendi');

    // yeniden yükleme: geçmiş sunucudan gelir
    await page.reload();
    await expect(page.getByRole('log')).toContainText('Bu hafta ne çalıştı?');
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });

  test('Rapor iste: tür çipleri, konu metni, günlük sınır nazik uyarı', async ({ page }) => {
    await page.goto('/veli');
    await page.getByTestId('rapor-iste').click();
    await expect(page.getByRole('radio')).toHaveText(['Haftalık', 'Deneme', 'Konu', 'Trend']);
    await page.getByRole('radio', { name: 'Konu' }).click();
    await page.getByRole('button', { name: 'İste' }).click();
    await expect(page.getByTestId('rapor-durum')).toHaveText('Hangi konu olsun? Birkaç sözcükle yazın.');
    await page.getByLabel('Hangi konu?').fill('rasyonel sayılar');
    await page.getByRole('button', { name: 'İste' }).click();
    await expect(page.getByTestId('rapor-durum')).toHaveText('Raporu hazırlıyorum; hazır olunca haber vereceğim.');
    await page.getByRole('radio', { name: 'Trend' }).click();
    await page.getByRole('button', { name: 'İste' }).click();
    await expect(page.getByTestId('rapor-durum')).toHaveText('Raporu hazırlıyorum; hazır olunca haber vereceğim.');
    await page.getByRole('radio', { name: 'Deneme' }).click();
    await page.getByRole('button', { name: 'İste' }).click();
    await expect.poll(async () => (await fake()).requests.length).toBe(3);
    // dördüncü istek: günlük sınır
    await page.getByRole('radio', { name: 'Haftalık' }).click();
    await page.getByRole('button', { name: 'İste' }).click();
    await expect(page.getByTestId('rapor-durum')).toHaveText('Bugün için rapor sınırına ulaşıldı. Yarın yeniden isteyebilirsiniz.');
    expect((await fake()).requests.map((r) => r.kind)).toEqual(['topic', 'trend', 'exam']);
    await page.screenshot({ path: `${SCREEN_DIR}/veli-rapor-iste-390.png` });
  });

  test('bildirim ayarları: kural anahtarları kaydedilir; VAPID anahtarı yokken anlık bildirim bölümü gizli', async ({ page }) => {
    await page.goto('/veli');
    await page.getByRole('link', { name: 'Bildirim ayarları' }).click();
    const sw = page.getByRole('switch', { name: 'Haftalık özet' });
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => JSON.stringify((await fake()).rules)).toContain('["weekly_summary",false]');
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Haftalık özet' })).toHaveAttribute('aria-checked', 'false');
    // tek e-posta anahtarı: bütün veli kurallarına e-posta kanalı
    const mail = page.getByRole('switch', { name: 'E-postayla da gönder' });
    await expect(mail).toHaveAttribute('aria-checked', 'false');
    await mail.click();
    await expect.poll(async () => (await fake()).channels[0]?.[1].length ?? 0).toBe(7);
    expect((await fake()).channels[0]![1].every(([, ch]) => ch.includes('email'))).toBe(true);
    await page.reload();
    await expect(page.getByRole('switch', { name: 'E-postayla da gönder' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('heading', { name: 'Bu cihazda' })).toHaveCount(0);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/veli-bildirimler-390.png` });
  });

  test('API: oturumsuz 401, öğrenci 403, başkasının çocuğu 403, başka köken 403, JSON olmayan gövde 415', async ({ request, browser }) => {
    const body = { student_id: '10000000-0000-4000-8000-0000000000ff', text: 'merhaba' };
    const anon = await request.post('/api/parent-chat', { data: body, maxRedirects: 0 });
    expect(anon.status()).toBe(401);
    const stu = await browser.newContext();
    await signInAs(stu, 'student');
    expect((await stu.request.post('/api/parent-chat', { data: body, maxRedirects: 0 })).status()).toBe(403);
    await stu.close();
    const par = await browser.newContext();
    await signInAs(par, 'parent');
    const other = await par.request.post('/api/parent-chat', { data: body, maxRedirects: 0 });
    expect(other.status()).toBe(403);
    expect((await other.json()).error.code).toBe('forbidden');
    const cross = await par.request.post('/api/parent-chat', { data: body, headers: { Origin: 'https://kotu.example' }, maxRedirects: 0 });
    expect(cross.status()).toBe(403);
    const plain = await par.request.post('/api/parent-chat', { data: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' }, maxRedirects: 0 });
    expect(plain.status()).toBe(415);
    await par.close();
  });
});
