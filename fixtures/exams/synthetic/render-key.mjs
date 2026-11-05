#!/usr/bin/env node
/**
 * Sentetik denemenin basılı cevap anahtarı sayfası: exam.json → answer-key.png (1240×1754, A4 150 dpi). Gerçek yayıncı
 * adı ya da logosu yoktur. apps/worker exam.live.test.ts "yüklenen anahtar sayfası" yolunda dördüncü sayfa olarak
 * kullanılır (sahte taşıma görseli okumaz; içerik exam.json anahtarıyla aynıdır).
 *
 *   node fixtures/exams/synthetic/render-key.mjs
 *
 * Playwright apps/web bağımlılığından yüklenir (Chromium: PLAYWRIGHT_BROWSERS_PATH).
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const require = createRequire(join(ROOT, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');

const exam = JSON.parse(readFileSync(join(HERE, 'exam.json'), 'utf8'));
const W = 1240;
const H = 1754;
const rows = exam.questions.map((q) => `<tr><td class="no">${q.no}</td><td class="ans">${q.answer}</td></tr>`).join('');
const html = `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: ${W}px; height: ${H}px; background: #fdfcf8; color: #1a1a1a; font-family: 'DejaVu Sans', sans-serif; }
  .page { padding: 110px 140px; }
  h1 { font-size: 44px; letter-spacing: 2px; margin: 0 0 10px; }
  .meta { font-size: 26px; color: #444; border-bottom: 3px solid #1a1a1a; padding-bottom: 18px; margin-bottom: 40px; }
  table { border-collapse: collapse; font-size: 34px; }
  td { border: 2px solid #1a1a1a; padding: 14px 48px; text-align: center; }
  td.no { font-weight: 700; background: #efece2; }
  .foot { position: absolute; bottom: 80px; left: 0; right: 0; text-align: center; font-size: 22px; color: #444; }
</style></head><body><div class="page">
  <h1>CEVAP ANAHTARI</h1>
  <div class="meta">${exam.title} · ${exam.section} · Kitapçık ${exam.booklet_type}</div>
  <table><tbody>${rows}</tbody></table>
</div><div class="foot">Sentetik deneme · yalnız test için</div></body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: join(HERE, 'answer-key.png'), fullPage: false });
  process.stdout.write('answer-key.png yazıldı\n');
} finally {
  await browser.close();
}
