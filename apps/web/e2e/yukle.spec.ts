import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { FAKE_URL, USERS } from './fixtures.mjs';
import { SCREEN_DIR, hasHorizontalOverflow, signInAs } from './helpers';

// Yükle → Teşhis → Sonuç/Detay (mockup S07, S05, S06) sahte Supabase'le: tarayıcı sayfayı küçültüp sahte Storage'a
// (kendi klasörüne) yükler, sunucu eylemi uploads satırlarını yazar ve submit_upload'ı çağırır; sahte worker ~2,5 sn
// sonra teşhis satırı yazar. Gerçek hat (RLS, apply_diagnosis, gözlemler) apps/worker/test/diagnosis.live.test.ts'te.

interface FakeState {
  objects: { path: string; bytes: number; contentType: string }[];
  uploads: { id: string; storage_path: string; kind: string; mime: string; status: string; width: number | null; height: number | null; owner_id: string }[];
}

async function fakeState(): Promise<FakeState> {
  return (await (await fetch(`${FAKE_URL}/__uploads`)).json()) as FakeState;
}

test.describe('Yükle → Teşhis', () => {
  test.beforeEach(async ({ context, page }) => {
    await signInAs(context, 'student');
    await page.setViewportSize({ width: 390, height: 844 });
  });

  test('klavye: Tab "Fotoğraf çek" düğmesine gelir, odak halkası görünür; gizli dosya girdisi odak almaz (WCAG 2.4.7)', async ({ page }) => {
    await page.goto('/ogrenci/yukle');
    await expect(page.getByRole('heading', { level: 1, name: 'Ne yüklüyorsun?' })).toBeVisible();
    const cam = page.getByRole('button', { name: /Fotoğraf çek/ });
    let reached = false;
    for (let i = 0; i < 30 && !reached; i++) {
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return { tag: el?.tagName ?? '', type: (el as HTMLInputElement | null)?.type ?? '', text: el?.textContent ?? '' };
      });
      expect(focused.type === 'file', 'dosya girdisi sekme sırasında olmamalı').toBe(false);
      reached = focused.tag === 'BUTTON' && /Fotoğraf çek/.test(focused.text);
    }
    expect(reached).toBe(true);
    await expect(cam).toBeFocused();
    const ring = await cam.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(ring).not.toBe('none');
    // Tab bir sonraki seçeneğe (Dosya/PDF seç) geçer
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: /Dosya\/PDF seç/ })).toBeFocused();
  });

  test('Kendi çalışmam: fotoğraf ≤ 2576 px küçültülür, kendi klasörüne yüklenir, bekleme → tek cümle → Detay → Koça sor', async ({ page }) => {
    await page.goto('/ogrenci/yukle');
    await expect(page.getByRole('heading', { level: 1, name: 'Ne yüklüyorsun?' })).toBeVisible();
    await expect(page.getByLabel(/Kendi çalışmam/)).toBeChecked();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/yukle-390.png`, fullPage: true });

    const photo = await sharp({ create: { width: 4032, height: 3024, channels: 3, background: { r: 240, g: 240, b: 235 } } }).jpeg().toBuffer();
    await page.getByTestId('kamera-girisi').setInputFiles({ name: 'soru.jpg', mimeType: 'image/jpeg', buffer: photo });
    await expect(page.getByText('1 sayfa hazır')).toBeVisible();
    await page.getByRole('button', { name: 'Gönder' }).click();

    await page.waitForURL(/\/ogrenci\/sonuc\?yukleme=[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: 'İnceliyorum…' })).toBeVisible();
    await page.screenshot({ path: `${SCREEN_DIR}/yukle-bekleme-390.png` });

    const st = await fakeState();
    const up = st.uploads.at(-1)!;
    expect(up.storage_path).toBe(`${USERS.student.id}/${up.id}.jpg`);
    expect(up).toMatchObject({ kind: 'photo', mime: 'image/jpeg', width: 2576, height: 1932, owner_id: USERS.student.id });
    const obj = st.objects.find((o) => o.path === up.storage_path)!;
    expect(obj.contentType).toBe('image/jpeg');
    const stored = Buffer.from(await (await fetch(`${FAKE_URL}/__uploads/object?path=${encodeURIComponent(up.storage_path)}`)).arrayBuffer());
    const meta = await sharp(stored).metadata();
    expect([meta.width, meta.height]).toEqual([2576, 1932]);

    // sonuç (S05): tek cümle + neyi öğrendik + Devam et (tek birincil)
    await expect(page.getByTestId('tek-cumle')).toHaveText('Çözümünü inceledim: 3. adımda işlem kuralı.', { timeout: 15_000 });
    await expect(page.getByText('Eksi işareti parantezdeki her terime dağılır.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Devam et' })).toHaveAttribute('href', '/ogrenci');
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/sonuc-390.png`, fullPage: true });

    // Detay (S06): neden cümlesi, katlı merdiven, kazanım bandı, Koça sor
    await page.getByRole('link', { name: 'Detay' }).click();
    await page.waitForURL(/\/ogrenci\/teshis\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('neden')).toContainText('3. adımda');
    const ladder = page.getByTestId('adim-merdiveni');
    await expect(ladder).not.toHaveAttribute('open', '');
    await expect(ladder.getByText('Burada bozuldu')).toBeHidden();
    await ladder.getByText('Adımları göster').click();
    await expect(ladder.locator('[aria-current="step"]')).toContainText('3. adım');
    await expect(ladder.getByText('Bundan etkilendi')).toBeVisible();
    await expect(page.getByTestId('kazanim')).toHaveText('Bu kazanım: Sayı kümeleri, işlem önceliği, işaret kuralları · şu an orta');
    const coach = page.getByRole('link', { name: 'Koça sor' });
    await expect(coach).toHaveCount(1);
    const href = await coach.getAttribute('href');
    const u = new URL(href!, 'http://x');
    expect(u.pathname).toBe('/ogrenci/koc');
    expect(u.searchParams.get('seed')).toMatch(/^[0-9a-f-]{36}$/);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SCREEN_DIR}/teshis-390.png`, fullPage: true });
  });

  test('Okul denemesi: PDF olduğu gibi gider, "Sayfaları aldım" sonucu', async ({ page }) => {
    await page.goto('/ogrenci/yukle');
    await page.getByText('Okul denemesi', { exact: true }).click();
    await expect(page.getByLabel(/Okul denemesi/)).toBeChecked();
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    await page.getByTestId('dosya-girisi').setInputFiles({ name: 'deneme.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.getByRole('button', { name: 'Gönder' }).click();
    await page.waitForURL(/\/ogrenci\/sonuc\?yukleme=[0-9a-f-]{36}&tur=deneme$/);
    await expect(page.getByTestId('tek-cumle')).toHaveText('Sayfaları aldım.', { timeout: 15_000 });
    const up = (await fakeState()).uploads.at(-1)!;
    expect(up).toMatchObject({ kind: 'pdf', mime: 'application/pdf', storage_path: `${USERS.student.id}/${up.id}.pdf` });
  });

  test('bilinmeyen sonuç bağlantısı boş durum çizer', async ({ page }) => {
    await page.goto('/ogrenci/sonuc?yukleme=00000000-0000-4000-8000-00000000dead');
    await expect(page.getByRole('heading', { name: 'Bu sonucu bulamadım' })).toBeVisible();
  });
});
