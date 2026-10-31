// `NEXT_PUBLIC_DATA_SOURCE=mock next build` çıktısı (BLUEPRINT §7 no_second_react_copy, CI out/ taraması).
// Not: Next 14 sayfa yönlendiricisi (_error/404 yedeği) için ayrı bir "framework" parçası üretir; hiçbir HTML sayfası onu yüklemez.
// Bu yüzden "tam bir React çalışma zamanı" sayımı sayfaların gerçekten yüklediği betikler üzerinden yapılır (README "Test notu").
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PANEL_DIR } from './helpers';

const OUT = join(PANEL_DIR, 'out');
// live derlemesi ayrı dizine (next.config.mjs PANEL_DIST_DIR; export çıktısı distDir'in kendisine yazılır)
const LIVE_DIR_NAME = '.next-live-test';
const LIVE_OUT = join(PANEL_DIR, LIVE_DIR_NAME);
const NEXT_BIN = join(PANEL_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
// Yerel veride olan, istemci paketinde asla olmaması gereken izler (cevap anahtarı, kimlik verisi, veli kodu, rol seçici)
const MOCK_ONLY = /answer_keys|canonical_expr|code_hash|code_plain|W4QX|7KD2|Elif Kaya|Mert Demir|Zeynep (Ç|\\xc7|\\u00c7)elik|@example\.com|Yerel veri|dev-seed/;
const SIGNATURE = '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED';
const ROUTES = ['index', 'giris', 'dersler', 'ders', 'cevaplar', 'kuyruk', 'oncelik', 'gruplar', 'ogrenciler', 'ogrenci', 'onaylar', 'maliyet', 'onay'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let build: { status: number | null; output: string };
let liveBuild: { status: number | null; output: string };
let unsetBuild: { status: number | null; output: string };

function nextBuild(env: Record<string, string | undefined>): { status: number | null; output: string } {
  const merged: Record<string, string | undefined> = { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1', ...env };
  for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
  const res = spawnSync(process.execPath, [NEXT_BIN, 'build'], { cwd: PANEL_DIR, env: merged as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 540000 });
  return { status: res.status, output: `${res.stdout}\n${res.stderr}` };
}

beforeAll(() => {
  // vitest.config.ts env NEXT_PUBLIC_DATA_SOURCE=mock verir; her derleme kendi değerini açıkça kurar
  unsetBuild = nextBuild({ NEXT_PUBLIC_DATA_SOURCE: undefined, PANEL_DIST_DIR: LIVE_DIR_NAME });
  rmSync(LIVE_OUT, { recursive: true, force: true });
  liveBuild = nextBuild({
    NEXT_PUBLIC_DATA_SOURCE: 'live',
    // yer tutucu değerler (gerçek proje yok); istemci yalnız tarayıcıda bağlanır
    NEXT_PUBLIC_SUPABASE_URL: 'https://proje.supabase.test',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test-key',
    PANEL_DIST_DIR: LIVE_DIR_NAME,
  });
  build = nextBuild({ NEXT_PUBLIC_DATA_SOURCE: 'mock', PANEL_DIST_DIR: undefined });
}, 1500000);

afterAll(() => {
  rmSync(LIVE_OUT, { recursive: true, force: true });
});

describe('statik export (mock)', () => {
  it('builds every route into out/', () => {
    expect(build.status, build.output).toBe(0);
    for (const r of ROUTES) expect([r, existsSync(join(OUT, `${r}.html`))]).toEqual([r, true]);
    expect(readFileSync(join(OUT, 'index.html'), 'utf8')).toContain('<html lang="tr"');
  });

  it('contains no keys, service role or CDN URLs', () => {
    const bad = /AIza|gsk_|sk-or-|service_role|eyJhbGci|cdn\.jsdelivr|unpkg\.com/;
    const hits = walk(OUT).filter((p) => /\.(html|js|css|txt|json)$/.test(p) && bad.test(readFileSync(p, 'utf8')));
    expect(hits.map((p) => relative(OUT, p))).toEqual([]);
  });

  it('no_second_react_copy', () => {
    const files = walk(OUT).map((p) => relative(OUT, p));
    // UMD/ikinci React dosyası yok
    expect(files.filter((f) => /(^|\/)react[^/]*\.js$/i.test(f))).toEqual([]);
    expect(readdirSync(join(PANEL_DIR, 'public', 'ds')).filter((f) => /^react/i.test(f))).toEqual([]);
    expect(readdirSync(join(OUT, 'ds')).filter((f) => /^react/i.test(f))).toEqual([]);
    expect(readFileSync(join(OUT, 'ds', 'bundle.js'), 'utf8')).not.toContain(SIGNATURE);
    // sayfaların yüklediği betikler
    const loaded = new Set<string>();
    for (const r of ROUTES) {
      const html = readFileSync(join(OUT, `${r}.html`), 'utf8');
      for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)) loaded.add(m[1].slice(1));
    }
    expect(loaded.size).toBeGreaterThan(3);
    // React çekirdeğini TANIMLAYAN dosya (PureComponent + iç nesne ataması): yüklenen betikler arasında tam bir tane
    const core = [...loaded].filter((f) => {
      const src = readFileSync(join(OUT, f), 'utf8');
      return src.includes(SIGNATURE) && src.includes('PureComponent');
    });
    expect(core).toHaveLength(1);
    // imza yalnız React çekirdeği ve react-dom parçasında geçer (ikisi de aynı örneğe bağlı)
    const withSig = [...loaded].filter((f) => readFileSync(join(OUT, f), 'utf8').includes(SIGNATURE));
    expect(withSig.length).toBeLessThanOrEqual(2);
    // pages yönlendiricisinin framework parçası hiçbir sayfaya yüklenmez
    expect([...loaded].filter((f) => /framework-/.test(f))).toEqual([]);
  });
});

describe('canlı derleme (live)', () => {
  it('a production build without an explicit data source fails', () => {
    expect(unsetBuild.status).not.toBe(0);
    expect(unsetBuild.output).toContain('NEXT_PUBLIC_DATA_SOURCE "live" ya da "mock" olmalı');
  });

  it('builds every route without bundling the mock world (dev-seed, answer keys, PII)', () => {
    expect(liveBuild.status, liveBuild.output).toBe(0);
    for (const r of ROUTES) expect([r, existsSync(join(LIVE_OUT, `${r}.html`))]).toEqual([r, true]);
    const files = walk(LIVE_OUT).filter((p) => /\.(html|js|css|txt|json)$/.test(p) && !p.includes(`${LIVE_DIR_NAME}/cache/`) && !p.includes(`${LIVE_DIR_NAME}/server/`));
    expect(files.length).toBeGreaterThan(10);
    const hits = files.filter((p) => MOCK_ONLY.test(readFileSync(p, 'utf8')));
    expect(hits.map((p) => relative(LIVE_OUT, p))).toEqual([]);
    const bad = /AIza|gsk_|sk-or-|service_role|eyJhbGci|cdn\.jsdelivr|unpkg\.com/;
    expect(files.filter((p) => bad.test(readFileSync(p, 'utf8'))).map((p) => relative(LIVE_OUT, p))).toEqual([]);
  });

  it('the mock build does contain the mock world (the live check above is meaningful)', () => {
    expect(build.status, build.output).toBe(0);
    const hits = walk(join(OUT, '_next')).filter((p) => p.endsWith('.js') && MOCK_ONLY.test(readFileSync(p, 'utf8')));
    expect(hits.length).toBeGreaterThan(0);
  });
});
