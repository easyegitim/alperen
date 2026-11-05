/** Test yardımcıları: PDF metin çıkarımı (pdfjs, node) ve sayfa rasterleştirme (pdfjs tarayıcıda, Playwright). */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBrowser } from '../src/pdf.js';

export const FIXTURES = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../fixtures/documents');
export const readFixture = <T = unknown>(name: string): T => JSON.parse(readFileSync(resolve(FIXTURES, name), 'utf8')) as T;

const require = createRequire(import.meta.url);

export async function pdfPages(pdf: Uint8Array): Promise<{ count: number; pages: string[] }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    pages.push(tc.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').trim());
  }
  const count = doc.numPages;
  await doc.destroy();
  return { count, pages };
}

/** PDF sayfalarını PNG'ye çizer (pdfjs tarayıcı derlemesi, yerel kökene yönlendirilmiş). */
export async function rasterize(pdf: Uint8Array, scale = 1.25): Promise<Uint8Array[]> {
  const buildDir = resolve(require.resolve('pdfjs-dist/package.json'), '../build');
  const lib = readFileSync(resolve(buildDir, 'pdf.min.mjs'));
  const worker = readFileSync(resolve(buildDir, 'pdf.worker.min.mjs'));
  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 1000, height: 1400 } });
  try {
    const origin = 'http://pdfjs.test';
    await context.route(`${origin}/**`, (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === '/pdf.min.mjs') return route.fulfill({ body: lib, contentType: 'text/javascript' });
      if (u.pathname === '/pdf.worker.min.mjs') return route.fulfill({ body: worker, contentType: 'text/javascript' });
      return route.fulfill({ body: '<!doctype html><meta charset=utf-8><body></body>', contentType: 'text/html' });
    });
    const page = await context.newPage();
    await page.goto(`${origin}/index.html`);
    // Not: import() vite dönüşümüne takılmasın diye betik düz dizgi olarak çalıştırılır.
    const script = `(async () => {
      const pdfjs = await import('${origin}/pdf.min.mjs');
      pdfjs.GlobalWorkerOptions.workerSrc = '${origin}/pdf.worker.min.mjs';
      const bytes = Uint8Array.from(atob('${Buffer.from(pdf).toString('base64')}'), (c) => c.charCodeAt(0));
      const doc = await pdfjs.getDocument({ data: bytes }).promise;
      const out = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const p = await doc.getPage(i);
        const vp = p.getViewport({ scale: ${scale} });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        await p.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        out.push(canvas.toDataURL('image/png'));
      }
      return out;
    })()`;
    const dataUrls = (await page.evaluate(script)) as string[];
    return dataUrls.map((d) => new Uint8Array(Buffer.from(d.split(',')[1] ?? '', 'base64')));
  } finally {
    await context.close();
  }
}

/** İki PNG'yi tarayıcıda piksel piksel karşılaştırır; farklı piksel oranını döndürür (kanal farkı > eşik). */
export async function pngDiffRatio(a: Uint8Array, b: Uint8Array, channelThreshold = 24): Promise<number> {
  const browser = await getBrowser();
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent('<!doctype html><body></body>');
    return await page.evaluate(
      async ({ a64, b64, t }) => {
        const load = (b64s: string) =>
          new Promise<HTMLImageElement>((res, rej) => {
            const im = new Image();
            im.onload = () => res(im);
            im.onerror = () => rej(new Error('png okunamadı'));
            im.src = `data:image/png;base64,${b64s}`;
          });
        const [ia, ib] = await Promise.all([load(a64), load(b64)]);
        if (ia.width !== ib.width || ia.height !== ib.height) return 1;
        const px = (im: HTMLImageElement) => {
          const c = document.createElement('canvas');
          c.width = im.width;
          c.height = im.height;
          const g = c.getContext('2d')!;
          g.drawImage(im, 0, 0);
          return g.getImageData(0, 0, im.width, im.height).data;
        };
        const da = px(ia);
        const db = px(ib);
        let diff = 0;
        for (let i = 0; i < da.length; i += 4) {
          if (Math.abs(da[i]! - db[i]!) > t || Math.abs(da[i + 1]! - db[i + 1]!) > t || Math.abs(da[i + 2]! - db[i + 2]!) > t) diff++;
        }
        return diff / (da.length / 4);
      },
      { a64: Buffer.from(a).toString('base64'), b64: Buffer.from(b).toString('base64'), t: channelThreshold },
    );
  } finally {
    await context.close();
  }
}
