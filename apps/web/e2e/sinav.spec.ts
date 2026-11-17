import { expect, test } from '@playwright/test';
import { FAKE_URL, WEB_URL } from './fixtures.mjs';
import { E2E_EXAM_ID } from './fake-exam.mjs';
import { SCREEN_DIR, hasHorizontalOverflow, signInAs } from './helpers';

// Uygulama içi deneme (mockup S04 + deneme kipi): Bugün'deki mini_exam önerisi → giriş → 3 soru çöz (biri işaretli,
// biri karalamalı) → ızgara → Bitir onayı → Sonuç yönlendirmesi; ağ kesintisinde cevaplar kuyrukta kalır; süre
// sunucudan gelir. Gerçek süre/notlama denetimi supabase/tests/19_exam_inapp.sql'dedir.

interface FakeExam {
  sessions: Array<{ id: string; status: string; started_at: string }>;
  responses: Array<{ session_id: string; exam_question_id: string; answer: string | null; flagged: boolean; work_upload_ids: string[] }>;
  uploads: Array<{ kind: string; storage_path: string; mime: string }>;
}

async function fakeExam(): Promise<FakeExam> {
  return (await (await fetch(`${FAKE_URL}/__exam`)).json()) as FakeExam;
}

test.describe('uygulama içi deneme', () => {
  test.beforeEach(async ({ page }) => {
    await fetch(`${FAKE_URL}/__exam/cleanup`);
    await fetch(`${FAKE_URL}/__exam/suggest`);
    await page.setViewportSize({ width: 390, height: 844 });
  });
  test.afterEach(async () => {
    await fetch(`${FAKE_URL}/__exam/cleanup`);
  });

  test('Bugün önerisinden başlar, 3 soru çözer, işaretler, karalar, bitirir', async ({ page, context }) => {
    test.setTimeout(90_000);
    await signInAs(context, 'student');
    await page.goto('/ogrenci');
    // mini_exam önerisi kahraman kart: Başla → giriş ekranı
    const hero = page.getByTestId('kahraman');
    await expect(hero.getByRole('heading', { name: 'TYT Matematik Deneme 1' })).toBeVisible();
    await hero.getByRole('button', { name: 'Başla' }).click();
    await expect(page).toHaveURL(new RegExp(`^${WEB_URL}/ogrenci/sinav/${E2E_EXAM_ID}(\\?oneri=[0-9a-f-]{36})?$`));
    await expect(page.getByRole('heading', { level: 1, name: 'TYT Matematik Deneme 1' })).toBeVisible();
    await expect(page.getByText('3 soru · 1 sa 15 dk')).toBeVisible();
    // giriş: tek birincil düğme; alt çubuk yok (odak ekranı)
    await expect(page.getByRole('button', { name: 'Başla' })).toHaveCount(1);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/sinav-giris-390.png` });
    await page.getByRole('button', { name: 'Başla' }).click();

    // oynatıcı
    await page.waitForURL(/\/ogrenci\/sinav\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    const timer = page.getByRole('timer', { name: 'Kalan süre' });
    await expect(timer).toBeVisible();
    await expect(timer).toHaveText(/1:14:5\d|1:15:00/);
    await expect(page.getByTestId('soru-no')).toHaveText('Soru 1 / 3');
    await expect(page.getByRole('radiogroup')).toBeVisible();
    for (const r of await page.getByRole('radio').all()) expect((await r.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/sinav-soru-390.png` });

    // Soru 1: B şıkkı + işaretle
    await page.getByRole('radio', { name: /B/ }).first().click();
    await page.getByRole('button', { name: 'İşaretle' }).click();
    await expect(page.getByRole('button', { name: 'İşaretle' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Sonraki' }).click();

    // Soru 2: karalama (tuvale çiz, kaydet) + C şıkkı
    await expect(page.getByTestId('soru-no')).toHaveText('Soru 2 / 3');
    await page.getByRole('button', { name: 'Karalama' }).click();
    const canvas = page.getByTestId('karalama-tuvali');
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 30, box.y + 30);
    await page.mouse.down();
    await page.mouse.move(box.x + 160, box.y + 90, { steps: 6 });
    await page.mouse.up();
    await page.screenshot({ path: `${SCREEN_DIR}/sinav-karalama-390.png` });
    await page.getByRole('button', { name: 'Kaydet' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Karalama, kaydedildi' })).toBeVisible();
    await page.getByRole('radio', { name: /C/ }).first().click();

    // ızgara: 2 cevaplı, 1 işaretli, 1 boş
    await page.getByRole('button', { name: 'Sorular' }).click();
    await expect(page.getByTestId('izgara-ozet')).toHaveText('2 cevaplı, 1 işaretli, 1 boş');
    await page.screenshot({ path: `${SCREEN_DIR}/sinav-izgara-390.png` });
    await page.getByRole('button', { name: 'Soru 3, boş' }).click();
    await expect(page.getByTestId('soru-no')).toHaveText('Soru 3 / 3');
    await page.getByRole('radio', { name: /E/ }).first().click();

    // son soru: Bitir → onay → Bitir
    await page.getByRole('button', { name: 'Bitir' }).click();
    await expect(page.getByTestId('bitir-onay')).toHaveText('Tüm soruları cevapladın. Sınavı bitirelim mi?');
    await page.getByRole('dialog').getByRole('button', { name: 'Bitir' }).click();
    await page.waitForURL(/\/ogrenci\/sonuc\?deneme=[0-9a-f-]{36}/);

    // sunucuda: 3 cevap, işaret, karalama yüklemesi, oturum kapandı
    const fake = await fakeExam();
    expect(fake.sessions).toHaveLength(1);
    expect(fake.sessions[0]!.status).toBe('analysing');
    const byAnswer = fake.responses.map((r) => `${r.answer}:${r.flagged}`).sort();
    expect(byAnswer).toEqual(['B:true', 'C:false', 'E:false']);
    expect(fake.responses.filter((r) => r.work_upload_ids.length === 1)).toHaveLength(1);
    expect(fake.uploads.filter((u) => u.kind === 'canvas' && u.mime === 'image/png')).toHaveLength(1);
  });

  test('ağ kesilince cevaplar kuyrukta kalır, bağlantı gelince gider; yeniden açılışta kaldığı yerden sürer', async ({ page, context }) => {
    test.setTimeout(90_000);
    await signInAs(context, 'student');
    await page.goto(`/ogrenci/sinav/${E2E_EXAM_ID}`);
    await page.getByRole('button', { name: 'Başla' }).click();
    await page.waitForURL(/\/ogrenci\/sinav\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    const playUrl = page.url();

    // sunucu eylemlerini kes
    await page.route('**/ogrenci/sinav/**', (route) => (route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue()));
    await page.getByRole('radio', { name: /D/ }).first().click();
    await expect(page.getByText('1 cevap henüz gönderilmedi')).toBeVisible();
    expect((await fakeExam()).responses).toHaveLength(0);

    // ağ kesikken sayfa yenilenir: kuyruktaki cevap ekrana yansır, hidrasyon hatası yok
    const errors: string[] = [];
    page.on('pageerror', (e) => {
      if (!/reading 'waiting'/.test(e.message)) errors.push(e.message);
    });
    page.on('console', (m) => {
      if (m.type() === 'error' && !/service.?worker|reading 'waiting'/i.test(m.text()) && !/Failed to load resource/i.test(m.text())) errors.push(m.text());
    });
    await page.reload();
    await expect(page.getByTestId('soru-no')).toHaveText('Soru 2 / 3');
    await page.getByRole('button', { name: 'Önceki' }).click();
    await expect(page.getByRole('radio', { name: /D/ }).first()).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByText('1 cevap henüz gönderilmedi')).toBeVisible();
    expect(errors).toEqual([]);

    // bağlantı geri gelir: kuyruk kendiliğinden boşalır
    await page.unroute('**/ogrenci/sinav/**');
    await expect(page.getByText(/henüz gönderilmedi/)).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(async () => (await fakeExam()).responses.map((r) => r.answer)).toEqual(['D']);

    // sayfa yenilenir: cevap sunucudan gelir, ilk boş soruda açılır; süre sunucudaki başlangıçtan sürer
    await page.goto(playUrl);
    await expect(page.getByTestId('soru-no')).toHaveText('Soru 2 / 3');
    await expect(page.getByRole('timer')).toHaveText(/1:14:\d\d|1:15:00/);
    await page.getByRole('button', { name: 'Önceki' }).click();
    await expect(page.getByRole('radio', { name: /D/ }).first()).toHaveAttribute('aria-checked', 'true');
  });

  test('süresi dolmuş oturum sayfa açılınca kendiliğinden biter', async ({ page, context }) => {
    test.setTimeout(60_000);
    await signInAs(context, 'student');
    await page.goto(`/ogrenci/sinav/${E2E_EXAM_ID}`);
    await page.getByRole('button', { name: 'Başla' }).click();
    await page.waitForURL(/\/ogrenci\/sinav\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    // oturumun başlangıcını geriye çek (süre sunucuda dolmuş olsun)
    await fetch(`${FAKE_URL}/__exam/age`, { method: 'POST' });
    await page.reload();
    await page.waitForURL(/\/ogrenci\/sonuc\?deneme=[0-9a-f-]{36}/, { timeout: 20_000 });
    expect((await fakeExam()).sessions[0]!.status).toBe('analysing');
  });
});
