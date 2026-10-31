// Statik denetimler (BLUEPRINT §7): tek primary, CDN yok, RPC adları donmuş, ham metin yalnız görünümlerden,
// design-system kopyasında React yok, tokens.css güncel, .gitignore ve lang="tr".
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PANEL_DIR } from './helpers';
// @ts-expect-error — .mjs betikleri tipsizdir
import { generate as generateTokensCss } from '../scripts/tokens-to-css.mjs';
// @ts-expect-error — .mjs betikleri tipsizdir
import { plan as syncPlan } from '../scripts/sync-ds.mjs';

function walk(dir: string, filter: (p: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.next', 'out'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, filter));
    else if (filter(p)) out.push(p);
  }
  return out;
}

const read = (p: string) => readFileSync(p, 'utf8');
/** Yorumlar atılmış kaynak: satır başı // yorumları ve blok yorumlar. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '');
const SOURCE_FILES = [...walk(join(PANEL_DIR, 'app'), (p) => /\.(tsx?|css)$/.test(p)), ...walk(join(PANEL_DIR, 'lib'), (p) => /\.(tsx?)$/.test(p)), ...walk(join(PANEL_DIR, 'components'), (p) => /\.tsx?$/.test(p))];

describe('statik denetimler', () => {
  it('primary_button_at_most_one_per_page', () => {
    const primaryRe = /variant=(?:"primary"|\{\s*'primary'\s*\}|\{\s*"primary"\s*\})|variant:\s*['"]primary['"]/g;
    const pages = SOURCE_FILES.filter((p) => p.endsWith('page.tsx'));
    expect(pages.length).toBe(13);
    for (const p of pages) {
      const n = (read(p).match(primaryRe) ?? []).length;
      expect([relative(PANEL_DIR, p), n <= 1]).toEqual([relative(PANEL_DIR, p), true]);
    }
    // primary yalnız sayfa dosyalarında; ortak bileşenler primary çizmez (sayfa başına tekliği bozmasın)
    for (const p of SOURCE_FILES.filter((x) => !x.endsWith('page.tsx'))) {
      expect([relative(PANEL_DIR, p), (read(p).match(primaryRe) ?? []).length]).toEqual([relative(PANEL_DIR, p), 0]);
    }
    // değişkenle seçilen variant yok (statik analiz kaçamasın)
    for (const p of SOURCE_FILES) expect([relative(PANEL_DIR, p), /variant=\{(?!\s*['"])/.test(read(p))]).toEqual([relative(PANEL_DIR, p), false]);
  });

  it('no_cdn_urls', () => {
    const cdn = /cdn\.jsdelivr|unpkg\.com|cdnjs|fonts\.googleapis|fonts\.gstatic|esm\.sh|skypack/;
    const files = [...SOURCE_FILES, join(PANEL_DIR, 'next.config.mjs'), ...walk(join(PANEL_DIR, 'public', 'ds'), (p) => /\.(js|css)$/.test(p))];
    for (const p of files) expect([relative(PANEL_DIR, p), cdn.test(read(p))]).toEqual([relative(PANEL_DIR, p), false]);
    // next/font ve next/script beforeInteractive kullanılmaz (ADR-0008)
    for (const p of SOURCE_FILES) {
      expect([relative(PANEL_DIR, p), /from 'next\/font|beforeInteractive|next\/script/.test(code(p))]).toEqual([relative(PANEL_DIR, p), false]);
    }
  });

  it('rpc_names_frozen', () => {
    const live = read(join(PANEL_DIR, 'lib', 'data', 'live.ts'));
    const called = [...live.matchAll(/\.rpc(?:<[^>]*>)?\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
    const frozen = JSON.parse(read(join(PANEL_DIR, 'test', 'rpc-names.json'))) as string[];
    expect([...new Set(called)].sort()).toEqual([...frozen].sort());
    expect(frozen).toEqual([...frozen].sort());
    // BLUEPRINT §3.9 sonundaki apps/panel/test/rpc-names.json listesi
    expect(frozen).toEqual(
      [
        'panel_overview', 'approve_lesson_analysis', 'approve_question', 'peek_answer_key', 'set_answer_key', 'person_labels', 'student_full_name',
        'add_instructor_note', 'mint_guardian_code', 'redeem_guardian_token', 'update_student_pii', 'link_staff_telegram', 'mint_staff_code',
        'approve_priority_plan', 'resolve_alert', 'set_runtime_flag', 'register_lesson', 'resolve_misconception', 'reject_misconception',
        'audit_recent', 'record_staff_consent', 'check_spend',
      ].sort(),
    );
  });

  it('live.ts reads raw text only from v_messages_staff / v_exam_items_full', () => {
    const live = read(join(PANEL_DIR, 'lib', 'data', 'live.ts'));
    const selects = [...live.matchAll(/\.from(?:<[^>]*>)?\(\s*'([a-z_]+)'\s*\)\s*\.select\(\s*'([^']*)'/g)].map((m) => ({ table: m[1], cols: m[2] }));
    expect(selects.length).toBeGreaterThan(30);
    const msgSelects = selects.filter((s) => s.table === 'messages');
    expect(msgSelects.length).toBeGreaterThan(0);
    for (const s of msgSelects) expect(s.cols).not.toMatch(/text_raw|\*/);
    for (const s of selects.filter((x) => x.table === 'exam_items')) expect(s.cols).not.toMatch(/ocr_text|\*/);
    for (const s of selects.filter((x) => /text_raw/.test(x.cols))) expect(s.table).toBe('v_messages_staff');
    for (const s of selects.filter((x) => /ocr_text/.test(x.cols))) expect(s.table).toBe('v_exam_items_full');
    // secure şeması ve service rolü canlı panel kodunda yok (mock.ts sunucu durumunu fixture'dan taklit eder; tarayıcıya giden canlı yol değildir)
    for (const p of SOURCE_FILES.filter((x) => !x.endsWith(join('data', 'mock.ts')))) {
      expect([relative(PANEL_DIR, p), /secure\.|service_role/.test(code(p))]).toEqual([relative(PANEL_DIR, p), false]);
    }
  });

  it('window.React is opened only in lib/ds-loader.tsx and Ogrenmen.* only via lib/ds.tsx', () => {
    for (const p of SOURCE_FILES) {
      const rel = relative(PANEL_DIR, p);
      const src = code(p);
      if (rel !== join('lib', 'ds-loader.tsx')) expect([rel, /window\.React(DOM)?\s*=/.test(src)]).toEqual([rel, false]);
      if (rel !== join('lib', 'ds.tsx') && rel !== join('lib', 'ds-loader.tsx')) expect([rel, /window\.Ogrenmen|\bOgrenmen\./.test(src)]).toEqual([rel, false]);
    }
  });

  it('every page is a client component and the layout has lang="tr" with DsLoader first', () => {
    for (const p of SOURCE_FILES.filter((x) => x.endsWith('page.tsx'))) expect(read(p).startsWith("'use client';")).toBe(true);
    const layout = read(join(PANEL_DIR, 'app', 'layout.tsx'));
    expect(layout).toContain('<html lang="tr"');
    expect(layout).toMatch(/<body>\s*<DsLoader \/>/);
    expect(layout).toContain('/ds/bundle.css');
  });

  it('sync-ds copies the bundle, fonts and mascot but never React', () => {
    const planned = (syncPlan() as [string, string][]).map(([, dst]) => dst);
    expect(planned).toEqual(expect.arrayContaining(['bundle.js', 'bundle.css', 'ogrenmen-maskot.webp', 'fonts/Lexend-400.woff2']));
    const files = walk(join(PANEL_DIR, 'public', 'ds'), () => true).map((p) => relative(join(PANEL_DIR, 'public', 'ds'), p));
    expect(files.sort()).toEqual([...planned].sort());
    expect(files.filter((f) => /(^|\/)react/i.test(f))).toEqual([]);
    expect(read(join(PANEL_DIR, 'public', 'ds', 'bundle.js'))).toBe(read(join(PANEL_DIR, '..', '..', 'packages', 'design-system', 'components', 'bundle.js')));
  });

  it('app/tokens.css is generated from tokens.json and up to date', () => {
    const css = read(join(PANEL_DIR, 'app', 'tokens.css'));
    expect(css).toBe(generateTokensCss());
    expect(css).toMatch(/:root, \[data-theme="light"\] \{[^}]*--primary: #0030a2;/);
    expect(css).toMatch(/\[data-theme="dark"\] \{[^}]*--primary: /);
    expect(css).toContain('--link: var(--primary);');
    expect(css).toContain('url("/ds/fonts/Lexend-400.woff2")');
    const used = [...new Set([...read(join(PANEL_DIR, 'public', 'ds', 'bundle.css')).matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]))];
    for (const v of used) expect([v, css.includes(`--${v}:`)]).toEqual([v, true]);
  });

  it('.gitignore keeps the design-system copy and build output out of git', () => {
    const gi = read(join(PANEL_DIR, '.gitignore')).split('\n').map((l) => l.trim());
    for (const e of ['public/ds/', 'out/', '.next/']) expect(gi).toContain(e);
    expect(existsSync(join(PANEL_DIR, 'test', 'rpc-names.json'))).toBe(true);
  });
});
