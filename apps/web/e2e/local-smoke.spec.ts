import { expect, test, type Page } from '@playwright/test';
import { LOCAL_DEMO_ACCOUNTS, LOCAL_DEV_OTP } from '../src/lib/local-dev';

// Yerel deneme dumanı (playwright.local.config.ts; açık `bun run local` yığını): giriş sayfasındaki yerel not ve demo hesap
// kısayolu → öğrenci girişi → Bugün kahraman kartı → Başla → bir soru cevaplanır; veli ve eğitmen kendi alanına iner.
// Kalıcı veritabanında koştuğu için tekrar edilebilir: yarım kalan test varsa kahraman kart onu sürdürür.

const SHOTS = 'test-results/local/screens';

async function signInAs(page: Page, label: string, email: string) {
  await page.goto('/giris');
  await expect(page.getByTestId('yerel-deneme')).toContainText(LOCAL_DEV_OTP);
  await page.getByRole('group', { name: 'Yerel deneme hesapları' }).getByRole('button', { name: label }).click();
  await expect(page.getByLabel('E-posta adresin')).toHaveValue(email);
  await page.getByRole('button', { name: 'Kod gönder' }).click();
  await page.getByLabel('E-posta kodu').fill(LOCAL_DEV_OTP);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
}

const account = (role: 'student' | 'parent' | 'admin') => {
  const a = LOCAL_DEMO_ACCOUNTS.find((x) => x.role === role);
  if (!a) throw new Error(`demo hesap yok: ${role}`);
  return a;
};

test('öğrenci: giriş → Bugün → Başla → bir soru', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const elif = account('student');
  await signInAs(page, elif.label, elif.email);
  await page.waitForURL(/\/ogrenci$/);

  // İlk öneriyi worker yazar (suggestions.refresh); kart gelene dek yenile
  const hero = page.getByTestId('kahraman');
  const start = hero.getByRole('button', { name: /^(Başla|Devam et)$/ }).or(hero.getByRole('link', { name: /^(Başla|Devam et)$/ }));
  for (let i = 0; i < 30 && !(await start.first().isVisible()); i++) {
    await page.waitForTimeout(2_000);
    await page.reload();
  }
  await expect(start.first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-bugun.png`, fullPage: true });

  await start.first().click();
  await page.waitForURL(/\/ogrenci\/test\/[0-9a-f-]{36}$/);
  const progress = page.getByRole('progressbar', { name: /^Soru \d+ \/ \d+$/ });
  await expect(progress).toBeVisible({ timeout: 90_000 });
  const [, at, total] = /^Soru (\d+) \/ (\d+)$/.exec((await progress.getAttribute('aria-label')) ?? '') ?? [];
  const n = Number(at);
  const radios = page.getByRole('radio');
  if ((await radios.count()) > 0) await radios.first().click();
  else await page.getByLabel('Cevabın').fill('1');
  await page.screenshot({ path: `${SHOTS}/02-test.png`, fullPage: true });
  if (n === Number(total)) {
    await page.getByRole('button', { name: 'Bitir' }).click();
    await page.waitForURL(/\/sonuc$/);
    await expect(page.getByTestId('tek-cumle')).toBeVisible();
  } else {
    await page.getByRole('button', { name: 'Sonraki' }).click();
    await expect(page.getByRole('progressbar', { name: `Soru ${n + 1} / ${total}` })).toBeVisible();
  }
});

test('veli ve eğitmen kendi alanına iner', async ({ browser }) => {
  for (const [role, area] of [['parent', /\/veli(\/|$)/], ['admin', /\/egitmen(\/|$)/]] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const a = account(role);
    await signInAs(page, a.label, a.email);
    await page.waitForURL(area);
    await expect(page.locator('main')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/03-${role}.png`, fullPage: true });
    await ctx.close();
  }
});
