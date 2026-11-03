import { expect, test, type Page } from '@playwright/test';
import { SCREEN_DIR, hasHorizontalOverflow, signInAs, type RoleKey } from './helpers';

const VIEWPORTS = [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
] as const;

const SHELLS: Array<{ role: RoleKey; path: string; nav: string[]; label: string }> = [
  { role: 'student', path: '/ogrenci', nav: ['Koç', 'Denemeler', 'Notlarım', 'Konu haritası', 'Profil'], label: 'ogrenci' },
  { role: 'parent', path: '/veli', nav: ['Özet', 'Sohbet', 'Raporlar', 'Bildirimler', 'Ayarlar'], label: 'veli' },
  { role: 'instructor', path: '/egitmen', nav: ['Öğrenciler', 'Dersler', 'Müfredatlar', 'Soru tarzları', 'İçerik', 'Sınavlar', 'Kuyruk', 'Maliyet', 'Ayarlar'], label: 'egitmen' },
];

async function visibleNavLinks(page: Page, names: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const name of names) {
    const link = page.getByRole('link', { name, exact: true }).filter({ visible: true });
    if ((await link.count()) > 0) found.push(name);
  }
  return found;
}

for (const shell of SHELLS) {
  for (const vp of VIEWPORTS) {
    test(`${shell.label} kabuğu ${vp.name}px: gezinme görünür, yatay taşma yok, ekran görüntüsü`, async ({ page, context }) => {
      await signInAs(context, shell.role);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(shell.path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

      const mobile = vp.width < 768;
      if (shell.role === 'instructor' && mobile) {
        // Dar ekranda 9 maddelik konsol "Menü" düğmesiyle açılır.
        const menu = page.getByRole('button', { name: 'Menü' });
        await expect(menu).toBeVisible();
        await expect(menu).toHaveAttribute('aria-expanded', 'false');
        await menu.click();
        await expect(menu).toHaveAttribute('aria-expanded', 'true');
      }
      expect(await visibleNavLinks(page, shell.nav)).toEqual(shell.nav);

      if (shell.role === 'student') {
        // Ortadaki kamera düğmesi "Sor": her iki yerleşimde görünür bir bağlantı.
        const fab = page.getByRole('link', { name: 'Sor', exact: true }).filter({ visible: true });
        await expect(fab).toHaveCount(1);
        await expect(fab).toHaveAttribute('href', '/ogrenci/sor');
        const box = await fab.boundingBox();
        expect(box && box.height >= 44 && box.width >= 44).toBe(true);
      }
      if (!mobile) {
        // Masaüstünde kenar çubuğu: alt çubuk yok.
        await expect(page.getByRole('navigation', { name: /alt çubuk/ })).toBeHidden();
      }

      expect(await hasHorizontalOverflow(page)).toBe(false);
      // Görünüm penceresi (sabit alt çubuk yerinde) ve tam sayfa iki ayrı dosya.
      await page.screenshot({ path: `${SCREEN_DIR}/${shell.label}-${vp.name}.png` });
      await page.screenshot({ path: `${SCREEN_DIR}/${shell.label}-${vp.name}-tam.png`, fullPage: true });
    });
  }
}

test('koyu tema: tercih saklanır, kabuk koyu zeminde çizilir ve yatay taşma yok', async ({ page, context }) => {
  await signInAs(context, 'student');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ogrenci/profil');
  await page.getByRole('button', { name: 'Koyu' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(7, 15, 46)');
  // Yeniden yükleme: boyama öncesi betik tercihi geri yükler.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Koyu' })).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(300); // renk geçişi (150 ms) bitsin
  expect(await hasHorizontalOverflow(page)).toBe(false);
  await page.screenshot({ path: `${SCREEN_DIR}/ogrenci-profil-koyu-390.png`, fullPage: true });
  await page.getByRole('button', { name: 'Açık' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const light = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(light).toBe('rgb(246, 248, 252)');
});
