#!/usr/bin/env node
/**
 * Sentetik okul denemesi görselleri: exam.json → booklet-p1.png, booklet-p2.png, answer-sheet.png (1240×1754, A4 150 dpi).
 * Gerçek yayıncı adı ya da logosu yoktur. Şeklin sayfa içi kutusu (0..1 oranlı) ölçülüp layout.json'a yazılır;
 * packages/llm/fixtures/exam_page_items sahte çıktısı bu değerleri kullanır.
 *
 *   node fixtures/exams/synthetic/render.mjs          # PNG + layout.json yazar
 *
 * Playwright apps/web bağımlılığından yüklenir (Chromium: PLAYWRIGHT_BROWSERS_PATH).
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const require = createRequire(join(ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');

const exam = JSON.parse(readFileSync(join(HERE, 'exam.json'), 'utf8'));
const W = 1240;
const H = 1754;
const KEYS = ['A', 'B', 'C', 'D', 'E'];

/** Sınırlı TeX → HTML (yalnız bu dosyadaki yapılar: \frac, ^, \le, \ge, \cdot, {,}). */
function tex(s) {
  return s.replace(/\$([^$]*)\$/g, (_, m) =>
    `<span class="m">${m
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\{,\}/g, ',')
      .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '<span class="fr"><span>$1</span><span>$2</span></span>')
      .replace(/\^(\d+)/g, '<sup>$1</sup>')
      .replace(/\\le\s?/g, '≤ ')
      .replace(/\\ge\s?/g, '≥ ')
      .replace(/\\cdot\s?/g, '· ')
      .replace(/-/g, '−')}</span>`,
  );
}

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; width: ${W}px; height: ${H}px; background: #fdfcf8; font-family: 'DejaVu Serif', Georgia, serif; color: #1a1a1a; }
  .page { position: relative; width: ${W}px; height: ${H}px; padding: 90px 110px; }
  .head { display: flex; justify-content: space-between; border-bottom: 3px solid #1a1a1a; padding-bottom: 14px; font-size: 26px; font-family: 'DejaVu Sans', sans-serif; }
  .sec { font-weight: 700; }
  .q { margin-top: 56px; font-size: 30px; line-height: 1.5; }
  .q b { margin-right: 10px; }
  .opts { margin: 14px 0 0 44px; display: grid; grid-template-columns: repeat(5, 1fr); column-gap: 18px; white-space: nowrap; font-size: 28px; }
  .m { font-style: italic; }
  .fr { display: inline-flex; flex-direction: column; vertical-align: middle; text-align: center; font-size: 24px; line-height: 1.1; margin: 0 3px; }
  .fr > span:first-child { border-bottom: 2px solid #1a1a1a; padding: 0 4px; }
  .fig { margin: 18px 0 6px 44px; }
  .cont { margin-top: 30px; font-size: 22px; font-family: 'DejaVu Sans', sans-serif; color: #444; text-align: right; }
  .foot { position: absolute; bottom: 70px; left: 0; right: 0; text-align: center; font-size: 24px; font-family: 'DejaVu Sans', sans-serif; }
  .sheet h1 { font-family: 'DejaVu Sans', sans-serif; font-size: 40px; margin: 0 0 8px; letter-spacing: 2px; }
  .sheet .meta { font-family: 'DejaVu Sans', sans-serif; font-size: 24px; margin-bottom: 40px; }
  .row { display: flex; align-items: center; height: 92px; font-family: 'DejaVu Sans', sans-serif; font-size: 30px; }
  .row .no { width: 90px; text-align: right; margin-right: 40px; font-weight: 700; }
  .bub { width: 64px; height: 64px; border: 3px solid #c0392b; border-radius: 50%; margin-right: 34px; display: flex; align-items: center; justify-content: center; color: #c0392b; font-size: 26px; }
  .bub.f { background: #1b1b1b; color: #1b1b1b; border-color: #1b1b1b; }
  .bt { display: flex; align-items: center; gap: 20px; margin-bottom: 36px; font-family: 'DejaVu Sans', sans-serif; font-size: 26px; }
  .grid { border: 3px solid #c0392b; padding: 20px 30px; width: 760px; }
`;

const NUMBER_LINE = `
<svg id="fig3" class="fig" width="900" height="130" viewBox="0 0 900 130" xmlns="http://www.w3.org/2000/svg">
  <line x1="20" y1="60" x2="880" y2="60" stroke="#1a1a1a" stroke-width="3"/>
  <polygon points="880,60 864,52 864,68" fill="#1a1a1a"/>
  <rect x="250" y="52" width="400" height="16" fill="#9a9a9a"/>
  ${[-4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map((v, i) => `<line x1="${80 + i * 80}" y1="50" x2="${80 + i * 80}" y2="70" stroke="#1a1a1a" stroke-width="2"/><text x="${80 + i * 80}" y="110" font-size="26" text-anchor="middle" font-family="DejaVu Sans">${v < 0 ? '−' + -v : v}</text>`).join('')}
  <circle cx="240" cy="60" r="12" fill="#1a1a1a"/>
  <circle cx="640" cy="60" r="12" fill="#fdfcf8" stroke="#1a1a1a" stroke-width="3"/>
</svg>`;

function question(q, page) {
  const stem = q.stem ?? (page === 1 ? q.stem_page1 : q.stem_page2);
  const showNo = q.stem !== undefined || page === 1;
  const showOpts = q.continues_on_page === undefined || page === q.continues_on_page;
  const opts = showOpts ? `<div class="opts">${q.options.map((o, i) => `<div>${KEYS[i]}) ${tex(o)}</div>`).join('')}</div>` : '';
  return `<div class="q">${showNo ? `<b>${q.no}.</b>` : ''}${tex(stem)}${q.figure ? NUMBER_LINE : ''}${opts}</div>`;
}

function bookletHtml(page) {
  const qs = exam.questions.filter((q) => q.page === page || q.continues_on_page === page);
  const cont = exam.questions.some((q) => q.page === page && q.continues_on_page) ? '<div class="cont">Soru arka sayfada devam ediyor.</div>' : '';
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="page">
    <div class="head"><span>${exam.title}</span><span class="sec">${exam.section} · Kitapçık ${exam.booklet_type}</span></div>
    ${qs.map((q) => question(q, page)).join('')}${cont}
    <div class="foot">${page}</div></div></body></html>`;
}

function sheetHtml() {
  const rows = exam.student_marks
    .map((m) => `<div class="row"><span class="no">${m.no}</span>${KEYS.map((k) => `<span class="bub${m.marks.includes(k) ? ' f' : ''}">${k}</span>`).join('')}</div>`)
    .join('');
  const bt = ['A', 'B', 'C', 'D'].map((k) => `<span class="bub${k === exam.booklet_type ? ' f' : ''}">${k}</span>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="page sheet">
    <h1>CEVAP KAĞIDI</h1><div class="meta">${exam.title} · ${exam.section} testi</div>
    <div class="bt">Kitapçık türü ${bt}</div>
    <div class="grid">${rows}</div></div></body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const layout = { width: W, height: H, figures: {} };
for (const n of [1, 2]) {
  await page.setContent(bookletHtml(n));
  const box = await page.locator('#fig3').boundingBox().catch(() => null);
  if (box) {
    const r = (v) => Math.round(v * 1000) / 1000;
    layout.figures['3'] = { page: n, bbox: { x: r(box.x / W), y: r(box.y / H), w: r(box.width / W), h: r(box.height / H) } };
  }
  await page.screenshot({ path: join(HERE, `booklet-p${n}.png`), fullPage: false });
}
await page.setContent(sheetHtml());
await page.screenshot({ path: join(HERE, 'answer-sheet.png'), fullPage: false });
await browser.close();
writeFileSync(join(HERE, 'layout.json'), `${JSON.stringify(layout, null, 2)}\n`);
console.log(JSON.stringify(layout));
