import { expect, test } from '@playwright/test';
import { SCREEN_DIR, hasHorizontalOverflow, signInAs } from './helpers';

// Koç sohbeti uçtan uca (sahte LLM + süreç içi sohbet deposu; playwright.config.ts webServer env).
const DEMO_SEED_ID = '7e5d0000-0000-4000-8000-0000000000a1';
// 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test.describe('Koç', () => {
  test('bir tur gönder-al: akışlı yanıt, mod seçici, yeniden yüklemede geçmiş; 390 px taşma yok', async ({ page, context }) => {
    await signInAs(context, 'student');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/ogrenci/koc');
    await expect(page.getByRole('heading', { level: 1, name: 'Koç' })).toBeVisible();
    await expect(page.getByText(/Ben senin AI koçunum/)).toBeVisible();
    await expect(page.getByRole('radio', { name: 'İpucu' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: /sesle/i })).toHaveCount(0);

    await page.getByRole('radio', { name: 'Açıkla' }).click();
    const box = page.getByLabel('Koça yaz');
    await box.fill('Kesirleri nasıl toplarım?');
    const replied = page.waitForResponse((r) => r.url().endsWith('/api/chat') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Gönder' }).click();
    const res = await replied;
    expect(res.headers()['content-type']).toContain('text/event-stream');
    const log = page.getByRole('log', { name: 'Öğrenmen ile sohbet' });
    await expect(log.getByText('Kesirleri nasıl toplarım?')).toBeVisible();
    await expect(log.getByText(/Sahte yanıt \(coach_chat/)).toBeVisible();
    await expect(box).toHaveValue('');
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/koc-390.png`, fullPage: true });
    // 360 px: mod seçicinin etiketleri düğmesinden taşmaz, sayfa yatay kaymaz.
    await page.setViewportSize({ width: 360, height: 780 });
    expect(await hasHorizontalOverflow(page)).toBe(false);
    const clipped = await page.getByRole('radiogroup', { name: 'Yanıt biçimi' }).evaluate((g) =>
      Array.from(g.querySelectorAll('button')).some((b) => b.scrollWidth > b.clientWidth + 1),
    );
    expect(clipped).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/koc-360.png`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });

    await page.reload();
    await expect(log.getByText('Kesirleri nasıl toplarım?')).toBeVisible();
    await expect(log.getByText(/Sahte yanıt \(coach_chat/)).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Açıkla' })).toHaveAttribute('aria-checked', 'true');
  });

  test('fotoğraf eki: küçük resim, gönderim, yanıt', async ({ page, context }) => {
    await signInAs(context, 'student');
    await page.goto('/ogrenci/koc');
    await page.getByTestId('koc-dosya').setInputFiles({ name: 'soru.png', mimeType: 'image/png', buffer: PNG });
    await expect(page.getByRole('list', { name: 'Ekler' }).getByRole('img', { name: 'Ek: soru.png' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Yükleniyor' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Gönder' })).toBeEnabled();
    await page.getByLabel('Koça yaz').fill('Bu soruda nerede yanlış yaptım?');
    await page.getByRole('button', { name: 'Gönder' }).click();
    const log = page.getByRole('log', { name: 'Öğrenmen ile sohbet' });
    await expect(log.getByText('Bu soruda nerede yanlış yaptım?').last()).toBeVisible();
    await expect(log.getByRole('img', { name: 'Eklediğin fotoğraf' }).last()).toBeVisible();
    await expect(log.getByText(/Sahte yanıt \(coach_chat/).last()).toBeVisible();
  });

  test('Koça sor derin bağlantısı: teşhis şeridi, hazır metin, gönderimde adres temizlenir', async ({ page, context }) => {
    await signInAs(context, 'student');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/ogrenci/koc?seed=${DEMO_SEED_ID}`);
    await expect(page.getByText('Teşhisin eklendi.')).toBeVisible();
    await expect(page.getByLabel('Koça yaz')).toHaveValue('Bu soruda nerede yanlış yaptım?');
    await page.getByRole('button', { name: 'Gönder' }).click();
    await expect(page).toHaveURL(/\/ogrenci\/koc$/);
    const log = page.getByRole('log', { name: 'Öğrenmen ile sohbet' });
    await expect(log.getByText('Teşhisin eklendi').last()).toBeVisible();
    await expect(log.getByText(/Sahte yanıt \(coach_chat/).last()).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/koc-1440.png`, fullPage: true });
  });

  test('API: oturumsuz istek JSON 401 alır (girişe yönlenmez), veli reddedilir', async ({ request, browser }) => {
    const anon = await request.post('/api/chat', { data: { text: 'x' }, maxRedirects: 0 });
    expect(anon.status()).toBe(401);
    expect((await anon.json()).error.code).toBe('unauthenticated');
    const ctx = await browser.newContext();
    await signInAs(ctx, 'parent');
    const res = await ctx.request.post('/api/chat', { data: { text: 'x' }, maxRedirects: 0 });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe('forbidden');
    await ctx.close();
  });

  test('API kapıları: başka köken 403, JSON olmayan gövde 415, büyük yükleme gövde okunmadan 413', async ({ browser }) => {
    const ctx = await browser.newContext();
    await signInAs(ctx, 'student');
    const cross = await ctx.request.post('/api/chat', { data: { text: 'x' }, headers: { Origin: 'https://kotu.example' }, maxRedirects: 0 });
    expect(cross.status()).toBe(403);
    expect((await cross.json()).error.code).toBe('forbidden_origin');
    const plain = await ctx.request.post('/api/chat', { data: JSON.stringify({ text: 'x' }), headers: { 'Content-Type': 'text/plain' }, maxRedirects: 0 });
    expect(plain.status()).toBe(415);
    const big = await ctx.request.post('/api/chat/upload', {
      multipart: { file: { name: 'b.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(5 * 1024 * 1024, 0x20) } },
      maxRedirects: 0,
    });
    expect(big.status()).toBe(413);
    expect((await big.json()).error.code).toBe('file_too_large');
    await ctx.close();
  });
});
