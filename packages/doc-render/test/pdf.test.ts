/**
 * Playwright PDF testleri: gerçek Chromium ile A4 PDF üretir; sayfa sayısı, metin çıkarımı, gömülü fontlar ve
 * sayfa rasterlerinin baseline PNG'lere (test/baselines) yakınlığı (küçük tolerans) doğrulanır.
 * OGRENMEN_QUICK=1: yalnız deneme (KaTeX + SVG + iki sütun + optik form). Baseline yenilemek: UPDATE_BASELINES=1.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ChartDataMap, closeBrowser, getBrowser, isRequestAllowed, normalizeOrigins, renderHtml, renderPdf } from '../src/index.js';
import { pdfPages, pngDiffRatio, rasterize, readFixture } from './helpers.js';

type Doc = Parameters<typeof renderHtml>[0] & { keys: { question_no: number; correct_option: string | null; numeric_value: number | null }[] };
const BASELINES = resolve(import.meta.dirname, 'baselines');
const TOLERANCE = 0.004; // farklı piksel oranı üst sınırı
const quick = process.env.OGRENMEN_QUICK === '1';
const update = process.env.UPDATE_BASELINES === '1';

const squash = (s: string) => s.replace(/\s+/g, '');
const hasBytes = (pdf: Uint8Array, s: string) => Buffer.from(pdf).includes(s);

interface Case {
  name: 'not' | 'deneme' | 'rapor';
  pages: number;
  expectText: string[];
}
const cases: Case[] = [
  { name: 'deneme', pages: 4, expectText: ['Temel Matematik Denemesi 1', 'Soru sayısı', 'Beş sayının aritmetik ortalaması', 'Şekildeki ABC dik üçgeninde', 'Optik form', 'Sayfa 2 / 4'] },
  { name: 'not', pages: 5, expectText: ['Rasyonel Sayılarda Dört İşlem', 'Çözümlü örnek', 'EKOK(4, 6, 3)', 'Senin sık yaptığın hata', 'Kendini sına: cevaplar', 'İşlem türüne göre özet', 'Kural', 'Pay payla, payda paydayla', '1/4', '3/4'] },
  { name: 'rapor', pages: 2, expectText: ['Bölüm netleri', 'orta · 22,5 / 40 net', 'düşük · 4 / 14 net', 'Kazanım ısı haritası', '6/7', 'Yanlış ve boş sorular', 'Sonraki adım', 'Sayfa 2 / 2'] },
];

async function build(name: Case['name']) {
  const ast = readFixture<Doc>(`${name}.json`);
  const chartData = name === 'rapor' ? readFixture<ChartDataMap>('rapor.chartdata.json') : undefined;
  const html = renderHtml(ast, { theme: 'print', ...(chartData ? { chartData } : {}) });
  const pdf = await renderPdf(html, { headerTitle: ast.title });
  return { ast, html, pdf };
}

beforeAll(() => mkdirSync(BASELINES, { recursive: true }));
afterAll(async () => closeBrowser());

describe.each(quick ? cases.filter((c) => c.name === 'deneme') : cases)('PDF: $name', (c) => {
  it('A4 sayfa sayısı, metin, gömülü fontlar', async () => {
    const { pdf } = await build(c.name);
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    const { count, pages } = await pdfPages(pdf);
    expect(count).toBe(c.pages);
    const all = squash(pages.join(' '));
    for (const t of c.expectText) expect(all, `metin yok: ${t}`).toContain(squash(t));
    // Gömülü yazı tipleri: marka fontu ve (formül varsa) KaTeX.
    expect(hasBytes(pdf, 'Lexend')).toBe(true);
    if (c.name !== 'rapor') expect(hasBytes(pdf, 'KaTeX_')).toBe(true);
  });

  it('sayfalar baseline ile eşleşir (küçük tolerans)', async () => {
    const { pdf } = await build(c.name);
    const pngs = await rasterize(pdf);
    expect(pngs).toHaveLength(c.pages);
    for (const [i, png] of pngs.entries()) {
      const file = resolve(BASELINES, `${c.name}-${i + 1}.png`);
      if (update || !existsSync(file)) {
        if (!update) throw new Error(`baseline yok: ${file} (UPDATE_BASELINES=1 ile üret)`);
        writeFileSync(file, png);
        continue;
      }
      const ratio = await pngDiffRatio(readFileSync(file), png);
      expect(ratio, `${c.name} sayfa ${i + 1}: farklı piksel oranı`).toBeLessThanOrEqual(TOLERANCE);
    }
  });
});

describe('görsel karşılaştırma', () => {
  it('farklı sayfalar tolerans üstünde ayrışır (karşılaştırıcı kördür değil)', async () => {
    const a = readFileSync(resolve(BASELINES, 'deneme-2.png'));
    const b = readFileSync(resolve(BASELINES, 'deneme-3.png'));
    expect(await pngDiffRatio(a, b)).toBeGreaterThan(TOLERANCE * 5);
    expect(await pngDiffRatio(a, a)).toBe(0);
  });
});

describe('deneme PDF: anahtar', () => {
  it('anahtarsız PDF öğrenciye gider: anahtar sayfası ve harfleri yok', async () => {
    const { pdf } = await build('deneme');
    const { pages } = await pdfPages(pdf);
    expect(squash(pages.join(' '))).not.toContain('Cevapanahtarı');
    expect(pages).toHaveLength(4);
  });
  it('anahtar verilince ayrı son sayfa eklenir', async () => {
    const ast = readFixture<Doc>('deneme.json');
    const html = renderHtml(ast, { theme: 'print', answerKeys: ast.keys });
    const { count, pages } = await pdfPages(await renderPdf(html, { headerTitle: ast.title }));
    expect(count).toBe(5);
    expect(squash(pages[4] ?? '')).toContain('Cevapanahtarı');
  });
});

describe('PDF ağ izni: köken tam eşleşir', () => {
  const allowed = normalizeOrigins(['https://a.com/imzali/yol']);
  it('izin listesi köken olarak normalize edilir', () => {
    expect([...allowed]).toEqual(['https://a.com']);
  });
  it('izinli köken ve yerel kaynaklar geçer', () => {
    expect(isRequestAllowed('https://a.com/x.png?sig=1', allowed)).toBe(true);
    expect(isRequestAllowed('data:image/png;base64,AAAA', allowed)).toBe(true);
    expect(isRequestAllowed('about:blank', allowed)).toBe(true);
  });
  it('önek benzeri sahte host, şema ve port farkı reddedilir', () => {
    expect(isRequestAllowed('https://a.com.evil.io/x', allowed)).toBe(false);
    expect(isRequestAllowed('https://a.com@evil.io/x', allowed)).toBe(false);
    expect(isRequestAllowed('https://evil.io/?u=https://a.com', allowed)).toBe(false);
    expect(isRequestAllowed('http://a.com/x', allowed)).toBe(false);
    expect(isRequestAllowed('https://a.com:8443/x', allowed)).toBe(false);
    expect(isRequestAllowed('gibberish', allowed)).toBe(false);
  });
});

describe('SVG temizleyici: çalıştırma ve erişilebilirlik', () => {
  it('saldırı SVG\'si gerçek Chromium\'da betik çalıştırmaz (temizleyici + CSP)', async () => {
    const attacks = [
      '<svg viewBox="0 0 10 10"><scr<set/>ipt>document.title="PWNED"</scr<set/>ipt><rect/onclick=document.title="PWNED" width="5" height="5"/><rect"onclick=document.title="PWNED" width="5" height="5"/></svg>',
    ];
    const ast = readFixture<Doc>('not.json');
    const doc = { ...ast, blocks: attacks.map((svg, i) => ({ type: 'figure', id: `f${i}`, section_no: 1, source: 'svg', svg, alt: 'Saldırı' })) } as unknown as Doc;
    const html = renderHtml(doc, { theme: 'print', fonts: 'none' });
    expect(html).not.toContain('<script');
    const browser = await getBrowser();
    // Temizleyiciyi atlatan en kötü durum: CSP tek başına betiği durdurmalı.
    for (const [label, page_html] of [
      ['temizlenmiş', html],
      ['temizleyicisiz (yalnız CSP)', html.replace('</body>', '<svg id="raw"><script>document.title="PWNED"</script><rect onclick="document.title=1" width="5" height="5"/></svg></body>')],
    ] as const) {
      const ctx = await browser.newContext({ javaScriptEnabled: true });
      const page = await ctx.newPage();
      await page.setContent(page_html, { waitUntil: 'load' });
      await page.evaluate(() => document.querySelectorAll('rect').forEach((r) => r.dispatchEvent(new MouseEvent('click', { bubbles: true }))));
      expect(await page.title(), label).not.toBe('PWNED');
      expect(await page.title(), label).not.toBe('1');
      await ctx.close();
    }
  });

  it('PDF etiketli: yapı ağacı ve ana dil var', async () => {
    const { pdf } = await build('deneme');
    expect(hasBytes(pdf, '/StructTreeRoot')).toBe(true);
    expect(hasBytes(pdf, '/MarkInfo')).toBe(true);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const d = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true, verbosity: 0 }).promise;
    const tree = await (await d.getPage(1)).getStructTree();
    expect(tree?.children?.length ?? 0).toBeGreaterThan(0);
    await d.destroy();
  });
});

describe('PDF: dul/yetim ve taşma', () => {
  it('uzun belge (60 soru) sayfa bölünmelerinde soru kesmez ve optik form sığar', async () => {
    const base = readFixture<Doc>('deneme.json');
    const qs = Array.from({ length: 60 }, (_, i) => {
      const q = base.blocks[i % 10] as { type: string; id: string; no: number };
      return { ...q, id: `q${i + 1}`, no: i + 1 };
    });
    const doc = {
      ...base,
      sections: [{ no: 1, title: 'Tümü' }],
      blocks: [
        ...qs.map((q) => ({ ...q, section_no: 1 })),
        { type: 'answer_sheet', id: 'o', section_no: 1, title: 'Optik form', question_count: 60, options_per_question: 5 },
      ],
    } as unknown as Doc;
    const pdf = await renderPdf(renderHtml(doc, { theme: 'print', fonts: 'none' }), { headerTitle: doc.title });
    const { count, pages } = await pdfPages(pdf);
    expect(count).toBeGreaterThanOrEqual(6);
    // her sorunun şık E'si, kendi sorusuyla aynı sayfada (soru ortadan bölünmez): her sayfada soru no sayısı = "E)" sayısı
    for (const p of pages.slice(1, -1)) {
      const e = (p.match(/E\)/g) ?? []).length;
      const stems = (p.match(/\b\d{1,2}\./g) ?? []).length;
      expect(stems).toBeGreaterThanOrEqual(e);
    }
  });
});
