import { expect, test } from '@playwright/test';
import { FAKE_URL, WEB_URL } from './fixtures.mjs';
import { SCREEN_DIR, hasHorizontalOverflow, signInAs } from './helpers';

// Onboarding → Hazırlıyorum → Bugün → Başla → 2 soru → Sonuç → Gelişim (mockup S01, S02, S04, S05, S08, S09) sahte
// Supabase'le (e2e/fake-practice.mjs: P1 RPC'leri + worker benzetimi) ve sahte LLM'le. Gerçek notlama/RLS/BKT:
// test/student-flow.db.test.ts (gerçek Postgres).

interface FakePractice {
  sets: Array<{ id: string; status: string; suggestion_id: string | null }>;
  attempts: Array<{ question_id: string; is_correct: boolean; chosen: { key: string } }>;
}

async function fakePractice(): Promise<FakePractice> {
  return (await (await fetch(`${FAKE_URL}/__practice`)).json()) as FakePractice;
}

test.describe('öğrenci çekirdeği: Onboarding → Bugün → Test → Sonuç → Gelişim', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('yeni öğrenci tek soruyla başlar, ilk testini bitirir, sonucu ve gelişimini görür', async ({ page, context }) => {
    test.setTimeout(120_000);
    await signInAs(context, 'kurulum');
    const examDate = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);

    // S01: tek soru, 6 çip, tek birincil "Devam"
    await page.goto('/ogrenci');
    await expect(page).toHaveURL(`${WEB_URL}/hos-geldin`);
    await page.getByRole('link', { name: 'Öğrenciyim' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Hangi sınava hazırlanıyorsun?' })).toBeVisible();
    await expect(page.getByText('Merhaba, ben Öğrenmen. Planını ben kuracağım.')).toBeVisible();
    await page.getByRole('button', { name: 'TYT', exact: true }).click();
    await expect(page.getByRole('button', { name: 'TYT', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(250); // renk geçişi bitsin
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/onboarding-390.png` });
    await page.getByRole('button', { name: 'Devam' }).click();

    // S01 ikinci ekran: Hedef tarihin? (tek tarih alanı, tek birincil Bitir, Bilmiyorum atlar)
    await expect(page.getByRole('heading', { level: 1, name: 'Hedef tarihin?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Bitir' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Bilmiyorum' })).toBeVisible();
    await page.getByLabel('Hedef tarih').fill(examDate);
    await page.getByRole('button', { name: 'Bitir' }).click();

    // Hazırlıyorum… (müfredat taslağı; sahte worker ~3 sn) → Bugün
    await page.waitForURL(/\/ogrenci\/onboarding\?mufredat=[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Hazırlıyorum…' })).toBeVisible();
    await page.screenshot({ path: `${SCREEN_DIR}/hazirlik-390.png` });
    await page.waitForURL(`${WEB_URL}/ogrenci`, { timeout: 20_000 });

    // S02: kahraman kart (tek birincil Başla), 2 kutu, + yükle, belge kartı; alt çubukta 3 sekme
    await expect(page.getByRole('heading', { level: 1, name: 'Merhaba kurulum' })).toBeVisible();
    const hero = page.getByTestId('kahraman');
    await expect(hero.getByRole('heading', { name: 'Rasyonel sayılar' })).toBeVisible();
    await expect(hero.getByText('2 soru · 4 dk')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Diğer çalışmalar' }).getByRole('button')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Kendi çalışmanı veya okul denemeni yükle' })).toHaveAttribute('href', '/ogrenci/yukle');
    await expect(page.getByRole('button', { name: 'Aç: Rasyonel sayılar notun hazır' })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'Başla', exact: true })).toHaveCount(1);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/bugun-390.png`, fullPage: true });

    // S04: Başla → 2 soru; seçmeden Sonraki kapalı; son soruda "Bitir"
    await hero.getByRole('button', { name: 'Başla' }).click();
    await page.waitForURL(/\/ogrenci\/test\/[0-9a-f-]{36}$/);
    const setId = page.url().split('/').at(-1)!;
    await expect(page.getByRole('progressbar', { name: 'Soru 1 / 2' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('A ile B noktalarının tam ortasındaki');
    await expect(page.getByRole('img', { name: /Sayı doğrusu/ })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(5);
    await expect(page.getByRole('navigation', { name: /alt çubuk/ })).toHaveCount(0);
    const next = page.getByRole('button', { name: 'Sonraki' });
    await expect(next).toBeDisabled();
    await page.getByRole('radio', { name: /^B/ }).click();
    await expect(page.getByRole('radio', { name: /^B/ })).toHaveAttribute('aria-checked', 'true');
    await expect(next).toBeEnabled();
    await page.waitForTimeout(250); // renk geçişi bitsin
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/test-390.png`, fullPage: true });
    await next.click();

    await expect(page.getByRole('progressbar', { name: 'Soru 2 / 2' })).toBeVisible();

    // Yarım kalan test: Bugün'e dönünce "Devam et" kahraman kartı; kaldığı soruda sürer
    await page.goto('/ogrenci');
    const resume = page.getByTestId('kahraman');
    await expect(resume.getByRole('heading', { name: 'Yarım kalan testin' })).toBeVisible();
    await expect(resume.getByText('2 sorudan 1 tanesini çözdün.')).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'Başla', exact: true })).toHaveCount(0);
    await resume.getByRole('link', { name: 'Devam et' }).click();
    await page.waitForURL(`${WEB_URL}/ogrenci/test/${setId}`);
    await expect(page.getByRole('progressbar', { name: 'Soru 2 / 2' })).toBeVisible();

    // Yarım testin sonuç sayfasını GET ile açmak seti bitirmez; teste döner
    await page.goto(`/ogrenci/test/${setId}/sonuc`);
    await page.waitForURL(`${WEB_URL}/ogrenci/test/${setId}`);
    expect((await fakePractice()).sets.find((s) => s.id === setId)?.status).toBe('in_progress');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('ifadesinin eşiti hangisidir');
    await page.getByRole('radio', { name: /^A/ }).click();
    await page.getByRole('button', { name: 'Bitir' }).click();

    // S05: tek cümle sonuç; Detay katlı (en sık yanılgı); Devam et → Bugün
    await page.waitForURL(`${WEB_URL}/ogrenci/test/${setId}/sonuc`);
    await expect(page.getByTestId('tek-cumle')).toHaveText('Yarı yoldasın. Takıldığın yer: Sayı kümeleri, işlem önceliği, işaret kuralları.');
    await expect(page.getByText('2 sorudan 1 doğru')).toBeAttached();
    await expect(page.getByText('Eksi işareti parantezdeki her terime dağılır', { exact: true })).toBeVisible();
    const detail = page.getByTestId('detay');
    await expect(detail).toBeHidden();
    await page.getByRole('button', { name: 'Detay' }).click();
    await expect(detail.getByText('En sık yanılgı')).toBeVisible();
    await expect(detail.getByText('Bu sette 1 soruda bu kurala takıldın', { exact: false })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Koça sor' })).toHaveAttribute('href', '/ogrenci/koc');
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/test-sonuc-390.png`, fullPage: true });

    const st = await fakePractice();
    expect(st.sets.find((s) => s.id === setId)?.status).toBe('finished');
    expect(st.attempts.map((a) => [a.chosen.key, a.is_correct])).toEqual([
      ['B', true],
      ['A', false],
    ]);

    await page.getByRole('link', { name: 'Devam et' }).click();
    await expect(page).toHaveURL(`${WEB_URL}/ogrenci`);
    // başlatılan öneri düştü: sıradaki öneri kahraman kart
    await expect(page.getByTestId('kahraman').getByRole('heading', { name: 'Haftalık ödev' })).toBeVisible();

    // S08: üç sayı, haftalık çizgi, katlı Konular ve Belgelerim
    await page.getByRole('navigation', { name: 'Ana gezinme (alt çubuk)' }).getByRole('link', { name: 'Gelişim' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Gelişim' })).toBeVisible();
    const stats = page.getByTestId('uc-sayi');
    await expect(stats.locator('dd')).toHaveText(['2', 'henüz yok', /^\d+$/]);
    await expect(stats.locator('dt')).toHaveText(['soru' + 'bu hafta', 'net' + 'son deneme', 'gün' + 'TYT’ye']);
    await expect(page.getByTestId('haftalik-cizgi')).toHaveAttribute('aria-label', /bugün 2\.$/);
    await page.getByTestId('konular').locator('summary').click();
    await expect(page.getByTestId('konular').getByText('Rasyonel sayılar')).toBeVisible();
    await expect(page.getByTestId('konular').getByText('zayıf')).toBeVisible();
    await page.getByTestId('belgelerim').locator('summary').click();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/gelisim-390.png`, fullPage: true });

    // S09: belge PDF görüntüleyicide
    await page.getByTestId('belgelerim').getByRole('link', { name: 'Rasyonel sayılar · Not' }).click();
    await page.waitForURL(/\/ogrenci\/belge\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Rasyonel sayılar · Not' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Kapat' })).toHaveAttribute('href', '/ogrenci/gelisim');
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/belge-390.png` });
  });

  test('hedef tarihi bilmeyen öğrenci: Gelişim "tarih yok" der', async ({ page, context }) => {
    test.setTimeout(60_000);
    await signInAs(context, 'kurulum2');
    await page.goto('/hos-geldin?rol=ogrenci');
    await page.getByRole('button', { name: 'TYT', exact: true }).click();
    await page.getByRole('button', { name: 'Devam' }).click();
    await page.getByRole('button', { name: 'Bilmiyorum' }).click();
    await page.waitForURL(`${WEB_URL}/ogrenci`, { timeout: 20_000 });
    await page.goto('/ogrenci/gelisim');
    const stats = page.getByTestId('uc-sayi');
    await expect(stats.locator('dd').last()).toHaveText('tarih yok');
    await expect(stats.locator('dt').last()).toHaveText('gün' + 'TYT’ye');
  });

  test('öneri yokken tek "İlk testine başla"; soru bankası boşsa sade bekleme', async ({ page, context }) => {
    await signInAs(context, 'student');
    await page.goto('/ogrenci');
    await expect(page.getByRole('heading', { level: 1, name: 'Merhaba Ayşe' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Koçun ilk önerini hazırlıyor' })).toBeVisible();
    await expect(page.locator('main').getByRole('button')).toHaveCount(1);
    await page.screenshot({ path: `${SCREEN_DIR}/bugun-bos-390.png` });
    await page.getByRole('button', { name: 'İlk testine başla' }).click();
    await page.waitForURL(/\/ogrenci\/test\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Soruları hazırlıyorum…' })).toBeVisible();
    await expect(page.getByTestId('hazirlaniyor-not')).toHaveText(/kendiliğinden açılır/);
    await expect(page.getByRole('link', { name: 'Bugün’e dön' })).toHaveAttribute('href', '/ogrenci');
    const st = await fakePractice();
    expect(st.sets.at(-1)).toMatchObject({ status: 'needs_generation', suggestion_id: null });
    // Bugün'e dönünce set yetim kalmaz: tek "Devam et" ile bekleme ekranına dönülür
    await page.goto('/ogrenci');
    await expect(page.getByText('Soruların hazırlanıyor.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Devam et' })).toBeVisible();
    await fetch(`${FAKE_URL}/__practice/cleanup`);
  });

  test('veli kabuğu: 2 sekme; Özet tek cümle + üç sayı, Sohbet karşılama', async ({ page, context }) => {
    await signInAs(context, 'parent');
    await page.goto('/veli');
    await expect(page.getByTestId('veli-durum')).toContainText('Ayşe bu hafta 4,5 saat çalıştı');
    await expect(page.getByRole('link', { name: 'Soru sor' })).toHaveAttribute('href', '/veli/sohbet');
    const bar = page.getByRole('navigation', { name: 'Ana gezinme (alt çubuk)' });
    await expect(bar.getByRole('link')).toHaveText(['Özet', 'Sohbet']);
    await page.screenshot({ path: `${SCREEN_DIR}/veli-ozet-390.png` });
    await bar.getByRole('link', { name: 'Sohbet' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sohbet' })).toBeVisible();
    await expect(page.getByText(/Çocuğunuzun bu hafta ne çalıştığını/)).toBeVisible();
  });
});
