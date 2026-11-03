import type { BrowserContext, Page } from '@playwright/test';
import { WEB_URL, USERS } from './fixtures.mjs';
import { cookieName, sessionCookieValue } from './jwt.mjs';

export type RoleKey = keyof typeof USERS;

/** Sahte oturum çerezini bağlama ekler (gerçek giriş akışını atlamak için). */
export async function signInAs(context: BrowserContext, role: RoleKey): Promise<void> {
  await context.addCookies([{ name: cookieName(), value: sessionCookieValue(USERS[role]), url: WEB_URL, httpOnly: false, sameSite: 'Lax' }]);
}

/** Yatay taşma yok: belge genişliği görünüm genişliğini aşmaz. */
export async function hasHorizontalOverflow(page: Page): Promise<boolean> {
  return page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
}

export const SCREEN_DIR = 'test-results/screens';
