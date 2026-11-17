import { expect, test } from '@playwright/test';
import { WEB_URL } from './fixtures.mjs';
import { signInAs } from './helpers';

test.describe('veli daveti (uçtan uca)', () => {
  test('oturumsuz davet bağlantısı girişe gider ve kodu korur', async ({ page }) => {
    const kod = 'gi_abcdefghijklmnopqrstuvwxyz234567';
    await page.goto(`/davet?kod=${kod}`);
    await expect(page).toHaveURL(`${WEB_URL}/giris?next=${encodeURIComponent(`/davet?kod=${kod}`)}`);
  });

  test('öğrenci kod üretir, veli bağlantıyla kurulumu bitirir, çocuk /veli özetinde görünür', async ({ page, context }) => {
    // 1) Öğrenci davet üretir.
    await signInAs(context, 'student');
    await page.goto('/ogrenci/profil');
    await page.getByRole('button', { name: 'Veli davet et' }).click();
    const kodEl = page.getByTestId('davet-kodu');
    await expect(kodEl).toBeVisible();
    const kod = (await kodEl.textContent())?.trim() ?? '';
    expect(kod).toMatch(/^gi_[a-z2-7]{32}$/);
    await expect(page.getByText('Bir kez kullanılır.', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kodu kopyala' })).toBeVisible();

    // 2) Veli aynı bağlantıyı açar: kurulum formunda kod önceden dolu gelir.
    await context.clearCookies();
    await signInAs(context, 'invitee');
    await page.goto(`/davet?kod=${kod}`);
    await expect(page).toHaveURL(`${WEB_URL}/hos-geldin?rol=veli&kod=${kod}`);
    await expect(page.getByLabel('Davet kodu')).toHaveValue(kod);
    await page.getByLabel('Adın').fill('Fatma Yılmaz');
    await page.getByRole('button', { name: 'Daveti kabul et' }).click();

    // 3) Çocuk özet sayfasında görünür.
    await expect(page).toHaveURL(`${WEB_URL}/veli`);
    await expect(page.getByRole('heading', { level: 1, name: 'Ayşe' })).toBeVisible();

    // 4) Kullanılmış kod yeniden kabul edilemez.
    await page.goto(`/veli/ayarlar?kod=${kod}`);
    await expect(page.getByLabel('Davet kodu')).toHaveValue(kod);
    await page.getByRole('button', { name: 'Daveti kabul et' }).click();
    await expect(page.getByText('Davet kodu bulunamadı ya da daha önce kullanılmış.')).toBeVisible();
  });
});
