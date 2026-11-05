/**
 * HTML → PDF (Playwright Chromium). Belge AST renderer'ı (packages/doc-render) HTML üretir; bu yardımcı onu A4 PDF yapar
 * (docs/PLAN-v2.md §7: `page.pdf`, A4, `@page`, iki sütun ÖSYM düzeni).
 *
 * - Tarayıcı süreç başına bir kez açılır ve yeniden kullanılır; her çıktı kendi bağlamında (context) üretilir.
 * - JavaScript kapalı ve service worker engelli: LLM'in ürettiği HTML betik çalıştıramaz, WebSocket açamaz.
 * - Ağ varsayılan olarak kapalı: yalnız `data:`, `about:` ve `blob:` istekleri geçer. Yazı tipleri HTML'e gömülür
 *   (data URI) ya da `allowedHosts` ile açıkça izin verilir. Böylece üretilen HTML dış kaynağa erişemez.
 * - Sayfa boyutu için CSS `@page { size: A4 }` önceliklidir (`preferCSSPageSize`); yoksa A4.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright-core';

export interface PdfOptions {
  /** Varsayılan A4. */
  format?: 'A4' | 'A3' | 'Letter';
  landscape?: boolean;
  /** CSS uzunluğu (ör. '18mm'); `@page` kenar boşluğu yoksa uygulanır. */
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
  printBackground?: boolean;
  displayHeaderFooter?: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  /** Sayfa yüklenirken izin verilen ana makineler (varsayılan: hiçbiri). */
  allowedHosts?: readonly string[];
  /** Zaman aşımı (ms). */
  timeoutMs?: number;
}

export interface PdfResult {
  pdf: Buffer;
  pages: number;
  bytes: number;
}

export class PdfRenderError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'PdfRenderError';
  }
}

export interface PdfRendererLike {
  render(html: string, opts?: PdfOptions): Promise<PdfResult>;
  close(): Promise<void>;
}

export interface PdfRendererOptions {
  /** Chromium çalıştırılabilir dosyası; verilmezse Playwright'ın kurulu sürümü (PLAYWRIGHT_BROWSERS_PATH). */
  executablePath?: string | null;
  /** Aynı anda en çok bağlam (sayfa). */
  maxConcurrent?: number;
  launchArgs?: string[];
}

/** PLAYWRIGHT_BROWSERS_PATH altında kurulu chromium'u bulur (sürüm numarası eşleşmese de). */
export function findInstalledChromium(root: string | undefined = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers'): string | null {
  if (!root || !existsSync(root)) return null;
  const dirs = readdirSync(root)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .reverse();
  for (const d of dirs) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const p = join(root, d, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/** Sayfa sayısı: PDF'teki `/Type /Page` nesneleri (`/Pages` hariç). Chromium (Skia) çıktısı için yeterli. */
export function countPdfPages(pdf: Buffer): number {
  const m = pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g);
  return m ? m.length : 0;
}

/** İlk sayfanın MediaBox'ı [x0 y0 x1 y1] (pt). Testler A4 (595×842) denetler. */
export function pdfMediaBox(pdf: Buffer): [number, number, number, number] | null {
  const m = pdf.toString('latin1').match(/\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
}

export class PdfRenderer implements PdfRendererLike {
  private browser: Promise<Browser> | null = null;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private readonly maxConcurrent: number;

  constructor(private readonly opts: PdfRendererOptions = {}) {
    this.maxConcurrent = Math.max(1, opts.maxConcurrent ?? 2);
  }

  private launch(): Promise<Browser> {
    if (!this.browser) {
      const executablePath = this.opts.executablePath || findInstalledChromium() || undefined;
      // Konteyner kök kullanıcısında Chromium sandbox'ı açılamaz; yalnız kök ise kapatılır.
      const root = typeof process.getuid === 'function' && process.getuid() === 0;
      const args = [...(root ? ['--no-sandbox'] : []), '--disable-dev-shm-usage', ...(this.opts.launchArgs ?? [])];
      this.browser = chromium
        .launch({ headless: true, executablePath, args })
        .then((b) => {
          b.on('disconnected', () => {
            this.browser = null;
          });
          return b;
        })
        .catch((err: unknown) => {
          this.browser = null;
          throw new PdfRenderError(`Chromium açılamadı${executablePath ? ` (${executablePath})` : ''}: ${(err as Error).message}`, err);
        });
    }
    return this.browser;
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next(); // yuva devredilir; active sayısı değişmez
    else this.active--;
  }

  async render(html: string, opts: PdfOptions = {}): Promise<PdfResult> {
    if (typeof html !== 'string' || html.trim() === '') throw new PdfRenderError('HTML boş');
    await this.acquire();
    let context: BrowserContext | null = null;
    try {
      const browser = await this.launch();
      context = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block', offline: false, locale: 'tr-TR' });
      const page = await context.newPage();
      const timeout = opts.timeoutMs ?? 60_000;
      page.setDefaultTimeout(timeout);
      const hosts = new Set((opts.allowedHosts ?? []).map((h) => h.toLowerCase()));
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith('data:') || url.startsWith('about:') || url.startsWith('blob:')) return route.continue();
        try {
          if (hosts.has(new URL(url).hostname.toLowerCase())) return route.continue();
        } catch {
          /* geçersiz adres: engellenir */
        }
        return route.abort('blockedbyclient');
      });
      await page.setContent(html, { waitUntil: 'load', timeout });
      await page.emulateMedia({ media: 'print' });
      // JS kapalı: `load` olayı gömülü @font-face ve görseller yüklenince tetiklenir (setContent zaten bekledi).
      const pdf = Buffer.from(
        await page.pdf({
          format: opts.format ?? 'A4',
          landscape: opts.landscape ?? false,
          printBackground: opts.printBackground ?? true,
          preferCSSPageSize: true,
          margin: opts.margin ?? { top: '18mm', right: '16mm', bottom: '18mm', left: '16mm' },
          displayHeaderFooter: opts.displayHeaderFooter ?? false,
          headerTemplate: opts.headerTemplate,
          footerTemplate: opts.footerTemplate,
        }),
      );
      if (pdf.length < 100 || pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new PdfRenderError('Chromium geçerli PDF üretmedi');
      return { pdf, pages: countPdfPages(pdf), bytes: pdf.length };
    } catch (err) {
      if (err instanceof PdfRenderError) throw err;
      throw new PdfRenderError(`PDF üretilemedi: ${(err as Error).message}`, err);
    } finally {
      if (context) await context.close().catch(() => undefined);
      this.release();
    }
  }

  async close(): Promise<void> {
    const b = this.browser;
    this.browser = null;
    if (b) await (await b).close().catch(() => undefined);
  }
}
