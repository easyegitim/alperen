/**
 * HTML -> PDF (Playwright Chromium, A4). Tarayıcı süreç boyunca yeniden kullanılır; her belge kendi bağlamında
 * (context) çizilir, ağ kapalıdır (yalnız data:/about: ve açıkça izinli kökenler).
 */
import { type Browser, chromium } from 'playwright-core';
import { PAGE } from './css.js';

export interface RenderPdfOptions {
  /** Üst bilgi metni (genellikle belge başlığı). Boşsa üst bilgi yok. */
  headerTitle?: string;
  /** Alt bilgi sol metni; varsayılan "Öğrenmen". */
  footerLabel?: string;
  /** Sayfa numarası "Sayfa X / Y" (varsayılan açık). */
  pageNumbers?: boolean;
  /**
   * Ağdan yüklenmesine izin verilen kökenler (ör. imzalı görsel adresleri), "https://host:port" biçiminde.
   * Eşleşme kökenin TAM eşitliğidir (şema, host, port); önek karşılaştırması yapılmaz. Varsayılan: hiçbiri.
   */
  allowOrigins?: readonly string[];
}

/** Eşzamanlı en fazla bu kadar PDF çizilir; paylaşılan tarayıcıda bağlam sayısı sınırlı kalır. */
const MAX_CONCURRENT_RENDERS = 2;
/** Tek bir belgenin çizim üst sınırı (ms). Aşılırsa bağlam kapatılır ve hata döner. */
const RENDER_TIMEOUT_MS = 60_000;

let browserPromise: Promise<Browser> | undefined;

/** Paylaşılan tarayıcı; kapanmışsa yeniden başlatır. */
export async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const b = await browserPromise.catch(() => undefined);
    if (b?.isConnected()) return b;
    browserPromise = undefined;
  }
  browserPromise = chromium.launch({ args: ['--no-sandbox', '--font-render-hinting=none'] });
  return browserPromise;
}

export async function closeBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = undefined;
  if (p) await (await p.catch(() => undefined))?.close();
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c);

function headerHtml(title: string | undefined): string {
  const t = title ? esc(title) : '';
  return `<div style="width:100%;padding:0 ${PAGE.marginXMm}mm;font-family:Lexend,'Segoe UI',sans-serif;font-size:7.5pt;color:#4a5578;display:flex;justify-content:space-between"><span>${t}</span></div>`;
}

function footerHtml(label: string, pageNumbers: boolean): string {
  const num = pageNumbers ? `<span>Sayfa <span class="pageNumber"></span> / <span class="totalPages"></span></span>` : '<span></span>';
  return `<div style="width:100%;padding:0 ${PAGE.marginXMm}mm;font-family:Lexend,'Segoe UI',sans-serif;font-size:7.5pt;color:#4a5578;display:flex;justify-content:space-between"><span>${esc(label)}</span>${num}</div>`;
}

let active = 0;
const waiting: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT_RENDERS) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve));
}

function releaseSlot(): void {
  const next = waiting.shift();
  // Yuva doğrudan bekleyene devredilir; sayaç değişmez.
  if (next) next();
  else active -= 1;
}

/** İzin listesini köken kümesine çevirir ("https://a.com/yol" -> "https://a.com"); geçersiz girdi yok sayılır. */
export function normalizeOrigins(list: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const x of list) {
    try {
      out.add(new URL(x).origin);
    } catch {
      // geçersiz giriş izin vermez
    }
  }
  return out;
}

/**
 * İstek izinli mi. data: ve about: yerel kaynaklardır; diğer her şey kökenin tam eşleşmesiyle izinlidir.
 * Ayrıştırılamayan URL reddedilir (ör. "https://a.com.evil.io" izinli "https://a.com" değildir).
 */
export function isRequestAllowed(url: string, allowed: ReadonlySet<string>): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'data:' || u.protocol === 'about:') return true;
  return allowed.has(u.origin);
}

async function renderPdfNow(html: string, options: RenderPdfOptions): Promise<Uint8Array> {
  const browser = await getBrowser();
  const context = await browser.newContext({ javaScriptEnabled: true, locale: 'tr-TR' });
  let timedOut = false;
  // Süre dolunca bağlamı kapatmak bekleyen tüm işlemleri (setContent, pdf) hatayla bitirir.
  const timer = setTimeout(() => {
    timedOut = true;
    void context.close().catch(() => undefined);
  }, RENDER_TIMEOUT_MS);
  try {
    const allowed = normalizeOrigins(options.allowOrigins ?? []);
    await context.route('**/*', (route) =>
      isRequestAllowed(route.request().url(), allowed) ? route.continue() : route.abort(),
    );
    const page = await context.newPage();
    await page.emulateMedia({ media: 'print' });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      tagged: true,
      outline: true,
      displayHeaderFooter: true,
      headerTemplate: headerHtml(options.headerTitle),
      footerTemplate: footerHtml(options.footerLabel ?? 'Öğrenmen', options.pageNumbers ?? true),
    });
    return new Uint8Array(buf);
  } catch (err) {
    if (timedOut) throw new Error(`PDF çizimi ${RENDER_TIMEOUT_MS / 1000} sn içinde tamamlanamadı`);
    throw err;
  } finally {
    clearTimeout(timer);
    await context.close().catch(() => undefined);
  }
}

/** A4 PDF üretir. Yazı tipleri gömülü HTML'den gelir (bkz. renderHtml). En çok iki eşzamanlı çizim, belge başına 60 sn. */
export async function renderPdf(html: string, options: RenderPdfOptions = {}): Promise<Uint8Array> {
  await acquireSlot();
  try {
    return await renderPdfNow(html, options);
  } finally {
    releaseSlot();
  }
}

/** Önizleme PNG'si (tam sayfa, ekran ortamı, 794 px = A4 genişliği). Görsel karşılaştırma ve küçük resimler için. */
export async function renderPreviewPng(html: string, options: { width?: number } = {}): Promise<Uint8Array> {
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: options.width ?? 794, height: 1123 } });
  try {
    await context.route('**/*', (route) => (/^(data|about):/.test(route.request().url()) ? route.continue() : route.abort()));
    const page = await context.newPage();
    await page.emulateMedia({ media: 'print' });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    return new Uint8Array(await page.screenshot({ fullPage: true, type: 'png' }));
  } finally {
    await context.close();
  }
}
