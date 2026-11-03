/**
 * Alıştırma soru bankası üreticisi (practice.generate / practice.prewarm; docs/PLAN-v2.md §13 "Test akışı").
 *
 *   1. Şablon yolu (sıfır LLM): `question_templates` → `py/template_fill.py` (`python3 -I`; içerik şablonları
 *      `content/tyt-matematik/templates`, SymPy anahtarı `verified`) → şekil PNG'si `figures` kovasına (rastgele
 *      `<uuid>.png`: yol şablon parametrelerinden türemez; aynı şekil yeniden yüklenmez; Storage yoksa şekilli varyant
 *      atılır) → `public.register_practice_questions`. Varyantın yaprakları korunur (hedef yaprak önce, en çok 3).
 *   2. LLM yolu (şablon yetmezse): rota `question_generation` (Opus 5.5 · medium, exam-generation şeması; sahte kipte
 *      `packages/llm/fixtures/question_generation` 8 soru). Şekilsiz (figure_svg dolu madde atılır), tarzsız. Hafif
 *      denetim (şıklar tekil, sayısal değer sonlu), sonra SymPy anahtar denetimi `py/key_verify.py` (`python3 -I`):
 *      canonical_expr ↔ numeric_value ya da doğru şıkkın metni. Çelişen ya da çok şıklı madde atılır; tutan madde
 *      `verified` yazılır; denetlenemeyen (canonical_expr boş/ayrıştırılamıyor, doğrulayıcı çalışmadı) madde
 *      `approved` ama anahtar `sympy_status='not_applicable'` + `sympy_report.status='inferred'`,
 *      `questions.verification.sympy='inferred'` (answer_practice_item gözlem ağırlığı practice_inferred_key_weight).
 *      Yapraklar istenen yapraklarla kesişmeli; kesişmeyen madde atılır (başka kazanımı ölçen soru yanlış yaprağa
 *      etiketlenmez). Yalnız sahte taşımada fikstürün sabit yaprak kodu istenen yaprağa eşlenir. content_hash LLM
 *      sorusunda müfredat + yaprak + kök + şıklardan (aynı kök başka yaprakta ayrı soru).
 * Yazım yalnız RPC ile (secure.answer_keys'e doğrudan yazım yok).
 */
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExamGeneration } from '@ogrenmen/contracts';
import type { Gateway } from '@ogrenmen/llm';
import type { Db } from '../db.js';
import { routePrompt } from '../curriculum/prompt.js';
import type { Logger } from '../log.js';
import type { StorageLike } from '../storage.js';

export const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const TEMPLATE_FILL_SCRIPT = fileURLToPath(new URL('../../py/template_fill.py', import.meta.url));
export const KEY_VERIFY_SCRIPT = fileURLToPath(new URL('../../py/key_verify.py', import.meta.url));
export const FIGURE_BUCKET = 'figures';
/** Tek LLM çağrısında en çok soru (exam-generation 200'e izin verir; öğrenci beklerken kısa tutulur). */
export const LLM_MAX_PER_CALL = 10;

export interface LeafStatus {
  skill_id: string;
  name: string;
  description: string | null;
  /** Kullanılabilir teşhis dışı soru (ön ısıtma bunu tamamlar). */
  available: number;
  /** Alıştırmada son çare kullanılabilir teşhis sorusu (0027). */
  diagnostic?: number;
  templates: string[];
}

export interface BankStatus {
  enrollment_id: string;
  curriculum_id: string;
  curriculum_status: string;
  practicable: boolean;
  leaves: LeafStatus[];
}

export async function bankStatus(db: Db, enrollmentId: string, skillIds: readonly string[] | null): Promise<BankStatus> {
  const r = await db.query('select public.practice_bank_status($1::uuid, $2::text[]) as s', [enrollmentId, skillIds && skillIds.length > 0 ? skillIds : null]);
  return r.rows[0]?.s as BankStatus;
}

/** Banka yazım maddesi (public.register_practice_questions p_items). */
export interface BankItem {
  source: 'template' | 'llm';
  kind: 'mcq' | 'numeric';
  stem: string;
  stem_values?: Record<string, unknown>;
  options?: { key: string; text: string; misconception_tag?: string | null }[] | null;
  skill_ids: string[];
  difficulty?: number | null;
  content_hash: string;
  template_id?: string;
  template_params?: Record<string, unknown>;
  verification: Record<string, unknown>;
  model?: string | null;
  cost_usd?: number;
  prompt_version?: string | null;
  figure?: { code: string; code_hash: string; alt_text: string; png_path: string; width_px: number; height_px: number; bytes: number } | null;
  key: {
    correct_option: string | null;
    numeric_value: string | null;
    numeric_tolerance?: number;
    canonical_expr: string | null;
    solution: string;
    sympy_status: 'verified' | 'not_applicable';
    sympy_report?: Record<string, unknown> | null;
  };
}

export interface RegisterResult {
  inserted: number;
  reused: number;
  skipped: number;
  question_ids: string[];
  set_id: string | null;
  filled: number;
  status: string | null;
}

export async function registerItems(db: Db, curriculumId: string, items: readonly BankItem[], setId: string | null): Promise<RegisterResult> {
  const out: RegisterResult = { inserted: 0, reused: 0, skipped: 0, question_ids: [], set_id: setId, filled: 0, status: null };
  // RPC en çok 40 madde alır; son parça seti doldurur
  const chunks: BankItem[][] = [];
  for (let i = 0; i < items.length; i += 40) chunks.push(items.slice(i, i + 40));
  if (chunks.length === 0) chunks.push([]);
  for (let i = 0; i < chunks.length; i++) {
    const last = i === chunks.length - 1;
    const r = await db.query('select public.register_practice_questions($1::uuid, $2::jsonb, $3::uuid) as r', [curriculumId, JSON.stringify(chunks[i]), last ? setId : null]);
    const x = (r.rows[0]?.r ?? {}) as Partial<RegisterResult>;
    out.inserted += Number(x.inserted ?? 0);
    out.reused += Number(x.reused ?? 0);
    out.skipped += Number(x.skipped ?? 0);
    out.question_ids.push(...(x.question_ids ?? []));
    if (last) {
      out.filled = Number(x.filled ?? 0);
      out.status = x.status ?? null;
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ şablon yolu

export interface TemplateVariant {
  template_id: string;
  skill_ids: string[];
  kind: 'mcq' | 'numeric';
  stem: string;
  stem_values: Record<string, unknown>;
  options: { key: string; text: string; misconception_tag: string | null }[];
  difficulty: number | null;
  template_params: Record<string, unknown>;
  content_hash: string;
  key: { correct_option: string | null; numeric_value: string | null; canonical_expr: string | null; solution: string; sympy_status: 'verified'; sympy_report: Record<string, unknown> | null };
  figure: { code: string; code_hash: string; alt_text: string; file: string; width_px: number; height_px: number; bytes: number } | null;
}

export interface TemplateRunRequest {
  templates: { id: string; count: number }[];
  seed: number;
  excludeHashes: string[];
  out: string;
}

export type TemplateRunner = (req: TemplateRunRequest, signal?: AbortSignal) => Promise<{ variants: TemplateVariant[]; errors: { template_id: string; error: string }[] }>;

/** `python3 -I <betik>` (stdin JSON → stdout JSON). Python yoksa ya da düşerse hata fırlatır. */
function runPython<T>(script: string, label: string, input: unknown, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const python = process.env.OGRENMEN_PYTHON || 'python3';
    const child = spawn(python, ['-I', script], { stdio: ['pipe', 'pipe', 'pipe'], signal, timeout: 30_000, cwd: tmpdir() });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d.slice(0, 4000)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`${label} ${code} ile çıktı: ${err.trim().slice(-500)}`));
      try {
        resolve(JSON.parse(out) as T);
      } catch (e) {
        reject(new Error(`${label} çıktısı okunamadı: ${(e as Error).message}`));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

/** `python3 -I py/template_fill.py` (stdin JSON → stdout JSON). Python yoksa ya da düşerse hata fırlatır. */
export const pythonTemplateRunner: TemplateRunner = (req, signal) =>
  runPython(TEMPLATE_FILL_SCRIPT, 'şablon doldurucu', { repo: REPO_ROOT, out: req.out, seed: req.seed, templates: req.templates, exclude_hashes: req.excludeHashes }, signal);

export interface TemplatePhaseInput {
  db: Db;
  log: Logger;
  curriculumId: string;
  /** yaprak → istenen soru sayısı (yalnız şablonu olan yapraklar kullanılır). */
  need: Map<string, number>;
  leaves: readonly LeafStatus[];
  storage: StorageLike | null;
  runner?: TemplateRunner;
  seed: number;
  signal?: AbortSignal;
}

export interface TemplatePhaseResult {
  items: BankItem[];
  perSkill: Map<string, number>;
  errors: string[];
}

/** Şablon başına istenen sayı: yaprağın ihtiyacı şablonlarına bölünür (+2 yedek: şekil kapısı ya da tekrar). */
export function templatePlan(need: Map<string, number>, leaves: readonly LeafStatus[]): { id: string; count: number; skill: string }[] {
  const plan: { id: string; count: number; skill: string }[] = [];
  for (const leaf of leaves) {
    const n = need.get(leaf.skill_id) ?? 0;
    if (n <= 0 || leaf.templates.length === 0) continue;
    const per = Math.ceil(n / leaf.templates.length) + 2;
    for (const id of leaf.templates) plan.push({ id, count: per, skill: leaf.skill_id });
  }
  return plan;
}

export async function templatePhase(inp: TemplatePhaseInput): Promise<TemplatePhaseResult> {
  const plan = templatePlan(inp.need, inp.leaves);
  const res: TemplatePhaseResult = { items: [], perSkill: new Map(), errors: [] };
  if (plan.length === 0) return res;
  const ids = plan.map((p) => p.id);
  const existing = await inp.db.query(`select q.content_hash from public.questions q where q.curriculum_id = $1::uuid and q.template_id = any($2::text[])`, [inp.curriculumId, ids]);
  const dir = await mkdtemp(join(tmpdir(), 'ogrenmen-tpl-'));
  try {
    const run = await (inp.runner ?? pythonTemplateRunner)(
      { templates: plan.map(({ id, count }) => ({ id, count })), seed: inp.seed, excludeHashes: existing.rows.map((r) => String(r.content_hash)), out: dir },
      inp.signal,
    );
    for (const e of run.errors) res.errors.push(`${e.template_id}: ${e.error}`);
    const skillOf = new Map(plan.map((p) => [p.id, p.skill]));
    /** code_hash → figures.png_path (bu çalıştırmada yüklenen ya da bankada doğrulanmış). */
    const pngOf = new Map<string, string>();
    for (const v of run.variants) {
      const skill = skillOf.get(v.template_id);
      if (!skill) continue;
      const have = res.perSkill.get(skill) ?? 0;
      if (have >= (inp.need.get(skill) ?? 0)) continue;
      let figure: BankItem['figure'] = null;
      if (v.figure) {
        if (!inp.storage) continue; // şekil yüklenemezse şekilli soru anlamsız
        // dosya adı rastgele: herkese açık kovadaki yol şablon parametrelerinden (code_hash) türemez (0027)
        let pngPath = pngOf.get(v.figure.code_hash);
        if (!pngPath) {
          try {
            const known = await inp.db.query(`select f.png_path from public.figures f where f.code_hash = $1 and f.review_status = 'verified' and f.png_path is not null`, [v.figure.code_hash]);
            if (known.rows.length > 0) {
              pngPath = String(known.rows[0]!.png_path);
            } else {
              const name = `${randomUUID()}.png`;
              await inp.storage.upload(FIGURE_BUCKET, name, await readFile(v.figure.file), 'image/png');
              pngPath = `${FIGURE_BUCKET}/${name}`;
            }
            pngOf.set(v.figure.code_hash, pngPath);
          } catch (e) {
            res.errors.push(`${v.template_id}: şekil yüklenemedi (${(e as Error).message.slice(0, 200)})`);
            continue;
          }
        }
        figure = { code: v.figure.code, code_hash: v.figure.code_hash, alt_text: v.figure.alt_text, png_path: pngPath, width_px: v.figure.width_px, height_px: v.figure.height_px, bytes: v.figure.bytes };
      }
      res.items.push({
        source: 'template',
        kind: v.kind,
        stem: v.stem,
        stem_values: v.stem_values,
        options: v.kind === 'mcq' ? v.options : null,
        // varyantın öteki yaprakları korunur (ör. mutlak değer + eşitsizlik); register müfredat dışı/yaprak olmayanı atar
        skill_ids: [skill, ...v.skill_ids.filter((s) => s !== skill)].slice(0, 3),
        difficulty: v.difficulty,
        content_hash: v.content_hash,
        template_id: v.template_id,
        template_params: v.template_params,
        verification: { schema: true, sympy: 'verified', render: figure ? 'ok' : 'not_applicable', vision: 'not_applicable', attempts: 1, origin: 'template' },
        figure,
        key: { ...v.key, sympy_status: 'verified' },
      });
      res.perSkill.set(skill, have + 1);
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
  return res;
}

// ------------------------------------------------------------------------------------------------ LLM yolu

export const QUESTION_GENERATION_SYSTEM = [
  'Sen Öğrenmen için Türkçe alıştırma sorusu yazan bir matematik ve ders öğretmenisin.',
  'Her soru tek bir kazanımı ölçer, öğrencinin seviyesine uygun ve kısadır. Kök açık ve tek anlamlıdır; matematik ifadeleri ters tırnak içinde yazılır (`3/4`).',
  'Çoktan seçmeli sorularda 4 ya da 5 şık olur; şıklar birbirinden farklıdır, tam biri doğrudur, yanlış şıklar tipik hatalardan gelir. Sayısal sorularda şık olmaz ve cevap tek bir sayıdır.',
  'Şekil kullanma: figure_svg her zaman null. Soru şekle başvurmaz. style_id her zaman null.',
  'Her soru için keys[] içinde ayrı anahtar yaz: doğru şık ya da sayısal değer, canonical_expr ve adım adım kısa çözüm.',
  'canonical_expr doğru cevabın kendisidir (denklem ya da soru değil), SymPy sözdiziminde: `Rational(5,6)`, `2**5`, `sqrt(3)`. Doğru şıkkın metni ya da sayısal değer bu ifadeye eşit olmalı; anahtar SymPy ile denetlenir, tutmayan soru atılır.',
  'Yalnız istenen kazanım kodlarını skill_ids alanında kullan.',
].join('\n');

export interface LlmPhaseInput {
  db: Db;
  gateway: Gateway;
  curriculumId: string;
  courseTitle: string;
  /** yaprak → istenen soru sayısı (toplam ≤ LLM_MAX_PER_CALL). */
  need: Map<string, number>;
  leaves: readonly LeafStatus[];
  ref: { table: string; id: string };
  studentRef?: string | null;
  signal?: AbortSignal;
  /** Anahtar doğrulayıcısı (varsayılan `python3 -I py/key_verify.py`). */
  verifier?: KeyVerifier;
}

export interface LlmPhaseResult {
  items: BankItem[];
  dropped: number;
  costUsd: number;
  model: string | null;
  /** SymPy anahtar denetimi: doğrulanan, denetlenemeyen (inferred), çelişip atılan; doğrulayıcı düştüyse hata. */
  verify: VerifySummary;
}

export function llmUserMessage(courseTitle: string, need: Map<string, number>, leaves: readonly LeafStatus[]): string {
  const rows = leaves
    .filter((l) => (need.get(l.skill_id) ?? 0) > 0)
    .map((l) => `- ${l.skill_id} (${need.get(l.skill_id)} soru): ${l.name}${l.description ? ` — ${l.description}` : ''}`);
  const total = [...need.values()].reduce((a, b) => a + Math.max(0, b), 0);
  return [`Ders: ${courseTitle}`, `Toplam ${total} alıştırma sorusu yaz. Kazanımlar:`, ...rows, 'Soruları karışık zorlukta (easy, medium, hard) yaz; çoğu çoktan seçmeli olsun.'].join('\n');
}

const DIFFICULTY: Record<string, number> = { easy: 0.3, medium: 0.5, hard: 0.7 };
const norm = (s: string) => s.split(/\s+/).filter(Boolean).join(' ').toLowerCase();

export function llmContentHash(curriculumId: string, skillIds: readonly string[], stem: string, options: readonly { key: string; text: string }[]): string {
  const body = `${norm(stem)}|${options.map((o) => `${o.key}:${norm(o.text)}`).join('|')}`;
  return createHash('sha256').update(`llm|${curriculumId}|${[...skillIds].sort().join(',')}|${body}`).digest('hex');
}

export interface MapOptions {
  curriculumId: string;
  need: Map<string, number>;
  model: string;
  costUsd: number;
  promptVersion: string;
  jobRef: string;
  /**
   * Yalnız sahte taşıma: fikstürün yaprak kodu sabittir (`tyt.mat.temel.sayilar`), istenen yaprağa sırayla eşlenir.
   * Gerçek modelde istenen yapraklarla kesişmeyen madde atılır.
   */
  remapForeignSkills?: boolean;
}

/** Model çıktısını banka maddelerine çevirir (yaprak eşleme, şekilli/tutarsız madde atma). */
export function mapGenerated(data: ExamGeneration, opts: MapOptions): { items: BankItem[]; dropped: number } {
  const wanted = [...opts.need.entries()].filter(([, n]) => n > 0).map(([s]) => s);
  const left = new Map(opts.need);
  const items: BankItem[] = [];
  let dropped = 0;
  let rr = 0;
  const keyOf = new Map(data.keys.map((k) => [k.question_no, k]));
  const perItemCost = data.items.length > 0 ? Number((opts.costUsd / data.items.length).toFixed(6)) : 0;
  for (const it of data.items) {
    const k = keyOf.get(it.no);
    if (!k || it.figure_svg !== null || wanted.length === 0) {
      dropped++;
      continue;
    }
    let skills = it.skill_ids.filter((s) => (left.get(s) ?? 0) > 0);
    if (skills.length === 0) {
      const open = wanted.filter((s) => (left.get(s) ?? 0) > 0);
      const codeless = it.skill_ids.length === 0 && wanted.length === 1;
      const foreign = it.skill_ids.length > 0 && !it.skill_ids.some((s) => wanted.includes(s));
      if (open.length === 0 || !(codeless || (opts.remapForeignSkills && foreign))) {
        // başka kazanımı ölçen soru yanlış yaprağa etiketlenmez (BKT kanıtı bozulur); kotası dolan yaprak da almaz
        dropped++;
        continue;
      }
      skills = [open[rr++ % open.length]!];
    }
    skills = skills.slice(0, 1);
    if (it.kind === 'mcq') {
      const texts = it.options.map((o) => norm(o.text));
      if (new Set(texts).size !== texts.length || !k.correct_option || !it.options.some((o) => o.key === k.correct_option)) {
        dropped++;
        continue;
      }
    } else if (k.numeric_value === null || !Number.isFinite(k.numeric_value)) {
      dropped++;
      continue;
    }
    left.set(skills[0]!, (left.get(skills[0]!) ?? 0) - 1);
    items.push({
      source: 'llm',
      kind: it.kind,
      stem: it.stem,
      options: it.kind === 'mcq' ? it.options.map((o) => ({ key: o.key, text: o.text, misconception_tag: null })) : null,
      skill_ids: skills,
      difficulty: DIFFICULTY[it.difficulty] ?? 0.5,
      content_hash: llmContentHash(opts.curriculumId, skills, it.stem, it.options),
      // anahtar denetimi (verifyKeys) tutarsa 'verified'e çevrilir
      verification: { schema: true, sympy: 'inferred', render: 'not_applicable', vision: 'not_applicable', attempts: 1, origin: 'llm', key_confidence: 'inferred', job: opts.jobRef },
      model: opts.model,
      cost_usd: perItemCost,
      prompt_version: opts.promptVersion,
      figure: null,
      key: {
        correct_option: it.kind === 'mcq' ? k.correct_option : null,
        numeric_value: it.kind === 'numeric' ? String(k.numeric_value) : null,
        canonical_expr: k.canonical_expr,
        solution: k.solution,
        sympy_status: 'not_applicable',
        sympy_report: { status: 'inferred', reason: 'anahtar model çıkarımı; SymPy denetimi bekliyor (questions.verification.sympy = inferred)' },
      },
    });
  }
  return { items, dropped };
}

// ------------------------------------------------------------------------------------------------ anahtar denetimi

export interface KeyCheckItem {
  id: string;
  kind: 'mcq' | 'numeric';
  canonical_expr: string | null;
  numeric_value: string | null;
  correct_option: string | null;
  options: { key: string; text: string }[];
}

export interface KeyCheckResult {
  id: string;
  status: 'verified' | 'mismatch' | 'ambiguous' | 'inferred';
  detail: string;
}

export type KeyVerifier = (items: readonly KeyCheckItem[], signal?: AbortSignal) => Promise<KeyCheckResult[]>;

/** `python3 -I py/key_verify.py` (SymPy; `_common.sympify_expr` / `values_equal`). */
export const pythonKeyVerifier: KeyVerifier = async (items, signal) =>
  (await runPython<{ results: KeyCheckResult[] }>(KEY_VERIFY_SCRIPT, 'anahtar doğrulayıcı', { repo: REPO_ROOT, items }, signal)).results;

export interface VerifySummary {
  verified: number;
  inferred: number;
  dropped: number;
  error: string | null;
  details: { content_hash: string; status: KeyCheckResult['status']; detail: string }[];
}

/**
 * LLM maddelerinin anahtarını SymPy ile denetler: çelişen/çok şıklı madde atılır, tutan `verified` olur, denetlenemeyen
 * `inferred` kalır. Doğrulayıcı çalışmazsa maddeler `inferred` kalır (answer_practice_item düşük ağırlık) ve hata döner.
 */
export async function verifyKeys(items: readonly BankItem[], verifier: KeyVerifier, signal?: AbortSignal): Promise<{ items: BankItem[]; summary: VerifySummary }> {
  const summary: VerifySummary = { verified: 0, inferred: 0, dropped: 0, error: null, details: [] };
  if (items.length === 0) return { items: [], summary };
  let results: KeyCheckResult[];
  try {
    results = await verifier(
      items.map((it, i) => ({
        id: String(i),
        kind: it.kind,
        canonical_expr: it.key.canonical_expr,
        numeric_value: it.key.numeric_value,
        correct_option: it.key.correct_option,
        options: (it.options ?? []).map((o) => ({ key: o.key, text: o.text })),
      })),
      signal,
    );
  } catch (e) {
    summary.error = (e as Error).message.slice(0, 300);
    summary.inferred = items.length;
    return { items: [...items], summary };
  }
  const byId = new Map(results.map((r) => [r.id, r]));
  const out: BankItem[] = [];
  items.forEach((it, i) => {
    const r = byId.get(String(i)) ?? { id: String(i), status: 'inferred' as const, detail: 'doğrulayıcı sonuç vermedi' };
    summary.details.push({ content_hash: it.content_hash, status: r.status, detail: r.detail });
    if (r.status === 'mismatch' || r.status === 'ambiguous') {
      summary.dropped++;
      return;
    }
    if (r.status === 'verified') {
      summary.verified++;
      out.push({
        ...it,
        verification: { ...it.verification, sympy: 'verified', key_confidence: 'verified' },
        key: { ...it.key, sympy_status: 'verified', sympy_report: { status: 'verified', checker: 'apps/worker/py/key_verify.py', detail: r.detail } },
      });
      return;
    }
    summary.inferred++;
    out.push({ ...it, key: { ...it.key, sympy_report: { status: 'inferred', reason: `SymPy ile denetlenemedi: ${r.detail}`.slice(0, 300) } } });
  });
  return { items: out, summary };
}

export async function llmPhase(inp: LlmPhaseInput, jobRef: string): Promise<LlmPhaseResult> {
  const total = [...inp.need.values()].reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return { items: [], dropped: 0, costUsd: 0, model: null, verify: { verified: 0, inferred: 0, dropped: 0, error: null, details: [] } };
  const prompt = await routePrompt(inp.db, 'question_generation', { name: 'question_generation', text: QUESTION_GENERATION_SYSTEM });
  const res = await inp.gateway.call('question_generation', {
    system: { product: prompt.text },
    user: llmUserMessage(inp.courseTitle, inp.need, inp.leaves),
    promptVersion: prompt.version,
    ref: inp.ref,
    studentRef: inp.studentRef ?? null,
    purpose: 'practice.generate',
    ...(inp.signal ? { signal: inp.signal } : {}),
  });
  const mapped = mapGenerated(res.data as ExamGeneration, {
    curriculumId: inp.curriculumId, need: inp.need, model: res.model, costUsd: res.costUsd, promptVersion: prompt.version, jobRef,
    remapForeignSkills: inp.gateway.transport.kind === 'fake',
  });
  const checked = await verifyKeys(mapped.items, inp.verifier ?? pythonKeyVerifier, inp.signal);
  return { items: checked.items, dropped: mapped.dropped + checked.summary.dropped, costUsd: res.costUsd, model: res.model, verify: checked.summary };
}

/** Ücretli çağrı izni (yalnız gerçek taşımada). */
export async function paidAllowed(db: Db): Promise<{ ok: boolean; state: string | null }> {
  const r = await db.query(`select paid_allowed, state from public.check_spend('practice.generate')`);
  const row = r.rows[0] as { paid_allowed?: boolean; state?: string } | undefined;
  return { ok: !row || row.paid_allowed !== false, state: row?.state ?? null };
}

/** `count` soruyu yapraklara sırayla dağıtır (ilk yaprak artanı alır). */
export function distribute(count: number, skills: readonly string[]): Map<string, number> {
  const m = new Map<string, number>(skills.map((s) => [s, 0]));
  for (let i = 0; i < count && skills.length > 0; i++) m.set(skills[i % skills.length]!, (m.get(skills[i % skills.length]!) ?? 0) + 1);
  return m;
}
