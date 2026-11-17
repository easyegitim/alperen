/**
 * Belge figürleri (document.generate, doğrulama merdiveninin 3. basamağı; docs/PLAN-v2.md §7):
 *
 *   figure_code → SVG:
 *     - kind=svg: kodun kendisi SVG metnidir (basit geometri).
 *     - kind=matplotlib, code_execution (gerçek anahtarla varsayılan): model kodu Anthropic code_execution konteynerinde
 *       çalıştırdı; `figure_<n>.svg` çıktıları Files API'den iner (`downloadFigureFiles`). İnmeyen ya da adı çakışan
 *       figür yerelde ÇALIŞTIRILMAZ: blok yeniden istenir (model kodu worker'da koşmaz).
 *     - kind=matplotlib, yerel (sahte LLM'de her zaman; gerçek anahtarla yalnız OGRENMEN_FIGURES=local):
 *       `python3 -I -c <py/figure_render.py>` OS yalıtımı içinde (documents/sandbox.ts: ayrı kullanıcı + pid/ağ/bağlama
 *       ad alanı, ortam boş), 10 sn, AST + yerleşik kısıtı, kaynak sınırları; başlık `FIGURE_PREAMBLE`. Yalıtım
 *       kurulamıyorsa yalnız güvenilir kod (sahte LLM fikstürü) yalıtımsız çalışır; model kodu çalışmaz.
 *   SVG → `sanitizeSvg` (doc-render: betik, olay özniteliği, foreignObject, dış bağlantı atılır) → sharp ile 640 px PNG →
 *   boş/boyut denetimi → `figure_check` (Haiku, PNG + bağlam; cevabı ele veren değer `hidden`).
 *
 * Sonuçlar SVG özetine göre önbelleklenir: yeniden üretim turunda değişmeyen figür yeniden çizilmez/denetlenmez.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { FigureRenderReport } from '@ogrenmen/contracts';
import { sanitizeSvg } from '@ogrenmen/doc-render';
import { downloadFigureFiles, type Gateway, type OutputFileRef } from '@ogrenmen/llm';
import { FIGURE_DESIGN, FIGURE_PREAMBLE, figureCheckUserText } from '@ogrenmen/prompts';
import { figureIsolation, isolatedCommand, type IsolatedCommand } from './sandbox.js';

export const FIGURE_RENDER_SCRIPT = fileURLToPath(new URL('../../py/figure_render.py', import.meta.url));
/** exam_questions.figure_svg ve AST `svg` üst sınırı (karakter). */
export const MAX_FIGURE_SVG = 60_000;
export const FIGURE_TIMEOUT_MS = 10_000;

export type FiguresMode = 'code_execution' | 'local';

/** Belgedeki bir kodlu figür (contracts `documentFigureJobs` ile aynı alanlar). */
export interface FigureTask {
  block_id: string;
  question_no: number | null;
  kind: 'matplotlib' | 'svg';
  code: string;
  file_name: string;
  alt: string;
  /** Figürün geçtiği soru kökü ya da çevresindeki metin (figure_check bağlamı). */
  context: string;
  /** Figürde görünmemesi gereken (cevabı ele veren) değerler. */
  hidden: (string | number)[];
}

export interface RenderedFigure {
  svg: string;
  via: 'code_execution' | 'local' | 'svg';
  width_px: number;
  height_px: number;
  bytes: number;
  png: Buffer;
}

export interface FigureRunOptions {
  /** Kod güvenilir mi (sahte LLM fikstürü): OS yalıtımı kurulamazsa yalnız güvenilir kod yalıtımsız çalışır. */
  trusted?: boolean;
}

export type FigureRun = (task: Pick<FigureTask, 'code' | 'file_name'>, signal?: AbortSignal, opts?: FigureRunOptions) => Promise<{ ok: true; svg: string } | { ok: false; error: string }>;

let mplDir: string | null = null;
function mplConfigDir(): string {
  if (!mplDir) {
    mplDir = join(tmpdir(), 'ogrenmen-mpl');
    mkdirSync(mplDir, { recursive: true });
  }
  return mplDir;
}

let scriptSrc: string | null = null;
const renderScript = () => (scriptSrc ??= readFileSync(FIGURE_RENDER_SCRIPT, 'utf8'));

function spawnFigure(cmd: IsolatedCommand, opts: { cwd: string; env: Record<string, string> } | null, task: Pick<FigureTask, 'code' | 'file_name'>, signal?: AbortSignal): Promise<{ ok: true; svg: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const env = opts?.env ?? { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' };
    const child = spawn(cmd.command, cmd.args, { ...(opts ? { cwd: opts.cwd } : {}), env, stdio: ['pipe', 'pipe', 'pipe'], timeout: FIGURE_TIMEOUT_MS, killSignal: 'SIGKILL', ...(signal ? { signal } : {}) });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err = (err + d).slice(-2000)));
    child.stdin.on('error', () => undefined);
    child.on('error', (e) => resolve({ ok: false, error: `figür üreticisi çalışmadı: ${e.message}`.slice(0, 300) }));
    child.on('close', (code, sig) => {
      if (sig === 'SIGXCPU') return resolve({ ok: false, error: `figür kodu CPU sınırını (${FIGURE_TIMEOUT_MS / 1000} sn) aştı` });
      if (sig) return resolve({ ok: false, error: `figür kodu ${FIGURE_TIMEOUT_MS / 1000} sn içinde bitmedi (${sig})` });
      try {
        const r = JSON.parse(out) as { ok: boolean; svg?: string; error?: string };
        if (r.ok && typeof r.svg === 'string') return resolve({ ok: true, svg: r.svg });
        return resolve({ ok: false, error: String(r.error ?? 'bilinmeyen hata').slice(0, 300) });
      } catch {
        if (code === 152 || /CPU time limit/i.test(err)) return resolve({ ok: false, error: `figür kodu CPU sınırını (${FIGURE_TIMEOUT_MS / 1000} sn) aştı` });
        return resolve({ ok: false, error: `figür üreticisi ${code} ile çıktı: ${err.trim().slice(-300)}` });
      }
    });
    child.stdin.end(JSON.stringify({ preamble: FIGURE_PREAMBLE, code: task.code, file_name: task.file_name }));
  });
}

let warnedUnisolated = false;

/**
 * Yerel matplotlib: figür başına ayrı süreç, en çok 10 sn. OS yalıtımı (documents/sandbox.ts) varsa onun içinde;
 * yoksa yalnız `trusted` kod (sahte LLM fikstürü) boş bir geçici dizinde yalıtımsız çalışır.
 */
export const localFigureRun: FigureRun = async (task, signal, opts = {}) => {
  const iso = await figureIsolation();
  if (iso.ok) return spawnFigure(isolatedCommand(iso, renderScript()), null, task, signal);
  if (!opts.trusted) return { ok: false, error: `figür kodu yalıtımsız çalıştırılmaz (${iso.reason})`.slice(0, 300) };
  if (!warnedUnisolated) {
    warnedUnisolated = true;
    process.emitWarning(`document.generate: figür yalıtımı yok, güvenilir (sahte) figür kodu yalıtımsız çalışıyor: ${iso.reason}`);
  }
  const dir = await mkdtemp(join(tmpdir(), 'ogrenmen-fig-'));
  try {
    const python = process.env.OGRENMEN_PYTHON || 'python3';
    const env: Record<string, string> = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, MPLCONFIGDIR: mplConfigDir(), LANG: 'C.UTF-8', MPLBACKEND: 'Agg' };
    return await spawnFigure({ command: python, args: ['-I', FIGURE_RENDER_SCRIPT] }, { cwd: dir, env }, task, signal);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
};

export interface RasterCheck {
  ok: boolean;
  reason?: string;
  png?: Buffer;
  width_px?: number;
  height_px?: number;
}

/** SVG → 640 px PNG; boş (tek renk), çok küçük ya da çok uzun figür reddedilir. */
export async function rasterize(svg: string): Promise<RasterCheck> {
  let img: Buffer;
  try {
    img = await sharp(Buffer.from(svg), { density: 144, limitInputPixels: 40_000_000 })
      .resize({ width: FIGURE_DESIGN.widthPx })
      .flatten({ background: FIGURE_DESIGN.paper })
      .png()
      .toBuffer();
  } catch (e) {
    return { ok: false, reason: `SVG çizilemedi: ${(e as Error).message}`.slice(0, 200) };
  }
  const meta = await sharp(img).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 100 || h < 40) return { ok: false, reason: `figür çok küçük (${w}×${h})` };
  if (h > 2400) return { ok: false, reason: `figür çok uzun (${w}×${h})` };
  const stats = await sharp(img).stats();
  const spread = Math.max(...stats.channels.slice(0, 3).map((c) => c.stdev));
  if (spread < 1.5) return { ok: false, reason: 'figür boş (tek renk)' };
  return { ok: true, png: img, width_px: w, height_px: h };
}

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export interface FigureCheckOutcome {
  ok: boolean;
  /** Saklanabilir neden (yalnız alan adları; cevabı ele verebilecek değer yok). */
  reason?: string;
  /** Modele giden ayrıntı (Haiku notları; gözlenen değerler cevabı içerebilir). */
  detail?: string;
  report?: FigureRenderReport;
  costUsd: number;
}

export interface FigureEnv {
  gateway: Gateway;
  mode: FiguresMode;
  prompt: { text: string; version: string };
  ref: { table: string; id: string };
  studentRef: string | null;
  signal?: AbortSignal;
  run?: FigureRun;
  /** false: figure_check atlanır (yalnız testler). */
  visionCheck?: boolean;
}

export async function figureCheck(env: FigureEnv, task: FigureTask, png: Buffer): Promise<FigureCheckOutcome> {
  const res = await env.gateway.call('figure_check', {
    system: { product: env.prompt.text },
    user: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } },
      { type: 'text', text: figureCheckUserText({ context: task.context, alt: task.alt, expected: {}, hidden: task.hidden }) },
    ],
    promptVersion: env.prompt.version,
    ref: env.ref,
    studentRef: env.studentRef,
    purpose: 'document.generate',
    ...(env.signal ? { signal: env.signal } : {}),
  });
  const report = res.data as FigureRenderReport;
  if (report.matches_stem) return { ok: true, report, costUsd: res.costUsd };
  const fields = [...new Set(report.mismatches.map((m) => (typeof m === 'string' ? 'diğer' : m.field)))].slice(0, 3).join(', ');
  const why = report.mismatches.map((m) => (typeof m === 'string' ? m : `${m.field}${m.note ? `: ${m.note}` : ''}`)).slice(0, 3).join('; ');
  return {
    ok: false,
    reason: `figür bağlamla uyuşmuyor (${fields || 'uyuşmazlık'})`.slice(0, 300),
    detail: `figür bağlamla uyuşmuyor (${why || 'uyuşmazlık'})`.slice(0, 500),
    report,
    costUsd: res.costUsd,
  };
}

export interface FigureResult {
  block_id: string;
  ok: boolean;
  /** Saklanabilir neden (verification'a yazılır). */
  reason?: string;
  /** Yalnız modele giden ayrıntı (yeniden üretim isteği). */
  detail?: string;
  svg?: string;
  via?: RenderedFigure['via'];
  width_px?: number;
  height_px?: number;
  bytes?: number;
  check?: 'match' | 'mismatch' | 'skipped';
}

/** Figür kodunun özeti (önbellek ve code_execution çıktısı eşlemesi). */
export const codeKey = (t: Pick<FigureTask, 'kind' | 'code'>) => sha(`${t.kind}\n${t.code}`);

/** code_execution çıktılarından figür SVG'leri (kod özeti → SVG); adı birden çok figürde geçen dosya kullanılmaz. */
export async function downloadedFigures(gateway: Gateway, refs: readonly OutputFileRef[], tasks: readonly FigureTask[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const files = gateway.transport.files;
  if (!files || refs.length === 0) return out;
  const { svgs } = await downloadFigureFiles(files, refs);
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(t.file_name, (counts.get(t.file_name) ?? 0) + 1);
  for (const t of tasks) {
    const svg = svgs[t.file_name];
    if (svg !== undefined && counts.get(t.file_name) === 1 && t.kind === 'matplotlib') out.set(codeKey(t), svg);
  }
  return out;
}

/** Önbellek: kod özeti → çizim; SVG özeti → denetim sonucu (aynı iş içinde turlar arası). */
export class FigureCache {
  readonly renders = new Map<string, { ok: true; svg: string; via: RenderedFigure['via'] } | { ok: false; error: string }>();
  readonly checks = new Map<string, FigureResult>();
  costUsd = 0;
}

/**
 * Figürleri çizer ve denetler. `remote`: code_execution'dan inen SVG'ler (kod özeti → SVG).
 * Döner: blok başına sonuç (ok ise temizlenmiş SVG).
 */
export async function renderAndCheckFigures(env: FigureEnv, tasks: readonly FigureTask[], remote: ReadonlyMap<string, string>, cache: FigureCache): Promise<FigureResult[]> {
  const run = env.run ?? localFigureRun;
  // sahte LLM'in figür kodu depodaki fikstürdür (güvenilir); gerçek model kodu yalnız OS yalıtımında çalışır
  const trusted = env.gateway.transport.kind === 'fake';
  const out: FigureResult[] = [];
  for (const t of tasks) {
    const key = codeKey(t);
    let src = cache.renders.get(key);
    const fromRemote = remote.get(key);
    if (fromRemote !== undefined) {
      src = { ok: true, svg: fromRemote, via: 'code_execution' };
    } else if (!src) {
      if (t.kind === 'svg') src = { ok: true, svg: t.code, via: 'svg' };
      else if (env.mode === 'code_execution') {
        // konteynerden inmedi: model kodu worker'da çalıştırılmaz, blok yeniden istenir (konteyner yeniden kullanılır)
        src = { ok: false, error: `${t.file_name} konteynerden inmedi (kodu code_execution ile çalıştırıp dosyayı bu adla yaz)` };
      } else {
        const r = await run(t, env.signal, { trusted });
        src = r.ok ? { ok: true, svg: r.svg, via: 'local' } : { ok: false, error: r.error };
      }
    }
    cache.renders.set(key, src);
    if (!src.ok) {
      out.push({ block_id: t.block_id, ok: false, reason: `figür kodu çalışmadı: ${src.error}`.slice(0, 300) });
      continue;
    }
    const clean = sanitizeSvg(src.svg);
    if (!clean) {
      out.push({ block_id: t.block_id, ok: false, reason: 'figür çıktısı geçerli bir SVG değil' });
      continue;
    }
    if (clean.length > MAX_FIGURE_SVG) {
      out.push({ block_id: t.block_id, ok: false, reason: `SVG çok büyük (${clean.length} karakter; sınır ${MAX_FIGURE_SVG})` });
      continue;
    }
    const checkKey = sha(`${clean}\n${t.context}\n${t.alt}\n${JSON.stringify(t.hidden)}`);
    const cached = cache.checks.get(checkKey);
    if (cached) {
      out.push({ ...cached, block_id: t.block_id });
      continue;
    }
    const raster = await rasterize(clean);
    let res: FigureResult;
    if (!raster.ok || !raster.png) {
      res = { block_id: t.block_id, ok: false, reason: raster.reason ?? 'figür çizilemedi' };
    } else if (env.visionCheck === false) {
      res = { block_id: t.block_id, ok: true, svg: clean, via: src.via, width_px: raster.width_px!, height_px: raster.height_px!, bytes: clean.length, check: 'skipped' };
    } else {
      const c = await figureCheck(env, t, raster.png);
      cache.costUsd += c.costUsd;
      res = c.ok
        ? { block_id: t.block_id, ok: true, svg: clean, via: src.via, width_px: raster.width_px!, height_px: raster.height_px!, bytes: clean.length, check: 'match' }
        : { block_id: t.block_id, ok: false, reason: c.reason!, ...(c.detail ? { detail: c.detail } : {}), check: 'mismatch' };
    }
    cache.checks.set(checkKey, res);
    out.push(res);
  }
  return out;
}
