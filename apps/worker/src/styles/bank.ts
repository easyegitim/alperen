/**
 * Tarza özel üretilen soruların bankaya yazımı (style.question_gen). Doğrulama merdiveni (docs/PLAN-v2.md §7):
 *   şema (gateway) → yapı (şık sayısı, tekil şıklar, kazanım tarzın yaprağı, arşiv metninden kopya yok) → SymPy anahtar denetimi (py/key_verify.py)
 *   → figür (varsa: kod → SVG → PNG → figure_check; yalnız Storage varken) → public.register_practice_questions.
 * Yalnız anahtarı SymPy ile DOĞRULANAN soru bankaya girer (status approved); denetlenemeyen (inferred) ya da çelişen soru
 * atılır. Kayıttan sonra sorulara `style_id` (kapsama) ve şekil yazılır (RPC şekilli LLM sorusunu kabul etmez; şekil
 * `figures` satırı review_status verified ile bağlanır, bağlanamazsa soru emekli edilir).
 */
import { randomUUID } from 'node:crypto';
import type { StyleQuestionGeneration } from '@ogrenmen/contracts';
import type { Gateway } from '@ogrenmen/llm';
import type { Db } from '../db.js';
import { renderAndCheckFigures, FigureCache, rasterize, sha, type FigureEnv, type FiguresMode } from '../documents/figures.js';
import { FIGURE_BUCKET, llmContentHash, registerItems, verifyKeys, type BankItem, type KeyVerifier, type VerifySummary } from '../practice/bank.js';
import type { StorageLike } from '../storage.js';
import { copiesArchiveQuestion } from './cluster.js';

const DIFFICULTY: Record<string, number> = { easy: 0.3, medium: 0.55, hard: 0.8 };
const norm = (s: string) => s.split(/\s+/).filter(Boolean).join(' ').toLowerCase();

export interface StyleBankItem extends BankItem {
  /** Kodla çizilecek şekil (bankaya kayıttan sonra bağlanır). */
  figureCode: { kind: 'matplotlib' | 'svg'; code: string; alt: string; no: number } | null;
}

export interface MapStyleOptions {
  curriculumId: string;
  styleId: string;
  leaves: readonly string[];
  model: string;
  costUsd: number;
  promptVersion: string;
  jobRef: string;
  /** Yalnız sahte taşıma: fikstürün yaprak kodu tarzın ilk yaprağına eşlenir. */
  remapForeignSkills: boolean;
  /**
   * Dersin çıkmış sınav metinleri (exam_items.ocr_text; yalnız worker okur). Kökü ya da bir şıkkı bunlardan birini
   * yeniden üreten madde atılır (cluster.ts copiesArchiveQuestion; telif: çıkmış soru bankaya girmez).
   */
  sources?: readonly string[];
}

/** Model çıktısı → banka maddeleri; yapısal olarak bozuk madde atılır (sayısı döner). */
export function mapStyleItems(data: StyleQuestionGeneration, o: MapStyleOptions): { items: StyleBankItem[]; dropped: { no: number; reason: string }[] } {
  const keyOf = new Map(data.keys.map((k) => [k.question_no, k]));
  const items: StyleBankItem[] = [];
  const dropped: { no: number; reason: string }[] = [];
  const perItemCost = data.items.length > 0 ? Number((o.costUsd / data.items.length).toFixed(6)) : 0;
  const seen = new Set<string>();
  for (const it of data.items) {
    const k = keyOf.get(it.no);
    if (!k) {
      dropped.push({ no: it.no, reason: 'anahtar yok' });
      continue;
    }
    let skills = it.skill_ids.filter((s) => o.leaves.includes(s));
    if (skills.length === 0 && o.remapForeignSkills && o.leaves.length > 0) skills = [o.leaves[0]!];
    if (skills.length === 0) {
      dropped.push({ no: it.no, reason: 'kazanım tarzın yaprağı değil' });
      continue;
    }
    const sources = o.sources ?? [];
    if (sources.length > 0 && [it.stem, ...it.options.map((x) => x.text)].some((t) => copiesArchiveQuestion(t, sources))) {
      dropped.push({ no: it.no, reason: 'arşiv metnine çok benziyor' });
      continue;
    }
    if (it.figure_svg !== null) {
      dropped.push({ no: it.no, reason: 'hazır SVG verisi (figür koddan çizilir)' });
      continue;
    }
    if (it.kind === 'mcq') {
      const texts = it.options.map((x) => norm(x.text));
      if (it.options.length < 4 || it.options.length > 5 || new Set(texts).size !== texts.length || !k.correct_option || !it.options.some((x) => x.key === k.correct_option)) {
        dropped.push({ no: it.no, reason: 'şıklar geçersiz' });
        continue;
      }
    } else if (k.numeric_value === null || !Number.isFinite(k.numeric_value)) {
      dropped.push({ no: it.no, reason: 'sayısal değer yok' });
      continue;
    }
    const hash = llmContentHash(o.curriculumId, skills, `style:${o.styleId}|${it.stem}`, it.options);
    if (seen.has(hash)) {
      dropped.push({ no: it.no, reason: 'yinelenen soru' });
      continue;
    }
    seen.add(hash);
    items.push({
      source: 'llm',
      kind: it.kind,
      stem: it.stem,
      options: it.kind === 'mcq' ? it.options.map((x) => ({ key: x.key, text: x.text, misconception_tag: null })) : null,
      skill_ids: skills.slice(0, 3),
      difficulty: DIFFICULTY[it.difficulty] ?? 0.55,
      content_hash: hash,
      verification: { schema: true, sympy: 'inferred', render: it.figure ? 'pending' : 'not_applicable', vision: 'not_applicable', attempts: 1, origin: 'llm', style_id: o.styleId, job: o.jobRef },
      model: o.model,
      cost_usd: perItemCost,
      prompt_version: o.promptVersion,
      figure: null,
      figureCode: it.figure ? { kind: it.figure.kind, code: it.figure.figure_code, alt: it.figure.alt, no: it.no } : null,
      key: {
        correct_option: it.kind === 'mcq' ? k.correct_option : null,
        numeric_value: it.kind === 'numeric' ? String(k.numeric_value) : null,
        canonical_expr: k.canonical_expr,
        solution: k.solution,
        sympy_status: 'not_applicable',
        sympy_report: { status: 'inferred', reason: 'SymPy denetimi bekliyor' },
      },
    });
  }
  return { items, dropped };
}

export interface StyleFigureEnv {
  db: Db;
  gateway: Gateway;
  storage: StorageLike | null;
  mode: FiguresMode;
  remote: ReadonlyMap<string, string>;
  figureEnv: Omit<FigureEnv, 'gateway' | 'mode'>;
}

interface RenderedPng {
  code_hash: string;
  tool: 'matplotlib' | 'svg';
  code: string;
  alt: string;
  png_path: string;
  width_px: number;
  height_px: number;
  bytes: number;
  vision: 'match' | 'skipped';
}

/** Şekilli maddelerin şekillerini çizer, denetler ve PNG'yi `figures` kovasına yükler; olmayan madde atılır. */
export async function renderStyleFigures(items: readonly StyleBankItem[], env: StyleFigureEnv): Promise<{ items: StyleBankItem[]; figures: Map<string, RenderedPng>; dropped: { no: number; reason: string }[]; costUsd: number }> {
  const withFig = items.filter((i) => i.figureCode);
  const figures = new Map<string, RenderedPng>();
  const dropped: { no: number; reason: string }[] = [];
  if (withFig.length === 0) return { items: [...items], figures, dropped, costUsd: 0 };
  if (!env.storage) {
    for (const i of withFig) dropped.push({ no: i.figureCode!.no, reason: 'şekil yüklenemez (Storage yok)' });
    return { items: items.filter((i) => !i.figureCode), figures, dropped, costUsd: 0 };
  }
  const cache = new FigureCache();
  const tasks = withFig.map((i) => ({
    block_id: i.content_hash, question_no: i.figureCode!.no, kind: i.figureCode!.kind, code: i.figureCode!.code,
    file_name: `figure_${i.figureCode!.no}.svg`, alt: i.figureCode!.alt, context: i.stem,
    hidden: [i.key.numeric_value ?? i.options?.find((x) => x.key === i.key.correct_option)?.text ?? ''].filter(Boolean) as string[],
  }));
  const results = await renderAndCheckFigures({ ...env.figureEnv, gateway: env.gateway, mode: env.mode }, tasks, env.remote, cache);
  const ok = new Set<string>();
  for (const r of results) {
    const it = withFig.find((i) => i.content_hash === r.block_id)!;
    if (!r.ok || !r.svg) {
      dropped.push({ no: it.figureCode!.no, reason: r.reason ?? 'şekil çizilemedi' });
      continue;
    }
    const raster = await rasterize(r.svg);
    if (!raster.ok || !raster.png) {
      dropped.push({ no: it.figureCode!.no, reason: raster.reason ?? 'şekil çizilemedi' });
      continue;
    }
    const name = `${randomUUID()}.png`;
    await env.storage.upload(FIGURE_BUCKET, name, raster.png, 'image/png');
    figures.set(it.content_hash, {
      code_hash: sha(`${it.figureCode!.kind}\n${it.figureCode!.code}`), tool: it.figureCode!.kind, code: it.figureCode!.code, alt: it.figureCode!.alt,
      png_path: `${FIGURE_BUCKET}/${name}`, width_px: raster.width_px!, height_px: raster.height_px!, bytes: raster.png.length,
      vision: r.check === 'match' ? 'match' : 'skipped',
    });
    ok.add(it.content_hash);
  }
  return { items: items.filter((i) => !i.figureCode || ok.has(i.content_hash)), figures, dropped, costUsd: cache.costUsd };
}

export interface StyleBankResult {
  verify: VerifySummary;
  registered: number;
  reused: number;
  question_ids: string[];
  dropped: { no: number; reason: string }[];
}

/** SymPy denetimi → yalnız doğrulanan maddeler bankaya; style_id ve şekil bağlanır. */
export async function writeStyleQuestions(
  db: Db,
  inp: { curriculumId: string; styleId: string; items: readonly StyleBankItem[]; figures: ReadonlyMap<string, RenderedPng>; verifier: KeyVerifier; signal?: AbortSignal },
): Promise<StyleBankResult> {
  const checked = await verifyKeys(inp.items, inp.verifier, inp.signal);
  const dropped: { no: number; reason: string }[] = [];
  const verified = (checked.items as StyleBankItem[]).filter((i) => i.key.sympy_status === 'verified');
  for (const i of inp.items) {
    if (!verified.some((v) => v.content_hash === i.content_hash)) {
      const d = checked.summary.details.find((x) => x.content_hash === i.content_hash);
      dropped.push({ no: i.figureCode?.no ?? 0, reason: `anahtar doğrulanmadı (${d?.status ?? 'inferred'})` });
    }
  }
  if (verified.length === 0) return { verify: checked.summary, registered: 0, reused: 0, question_ids: [], dropped };
  const bankItems: BankItem[] = verified.map(({ figureCode: _f, ...b }) => ({ ...b, verification: { ...b.verification, render: inp.figures.has(b.content_hash) ? 'ok' : 'not_applicable' } }));
  const reg = await registerItems(db, inp.curriculumId, bankItems, null);
  const hashes = verified.map((v) => v.content_hash);
  const tagged = await db.query(
    `update public.questions set style_id = $1::uuid where content_hash = any($2::text[]) and source = 'llm' and (style_id is null or style_id = $1::uuid)
     returning id, content_hash`,
    [inp.styleId, hashes],
  );
  for (const [hash, f] of inp.figures) {
    const q = tagged.rows.find((r) => String(r.content_hash) === hash);
    if (!q) continue;
    try {
      const fig = await db.query(
        `insert into public.figures (tool, code, code_hash, alt_text, png_path, width_px, height_px, bytes, render_status, vision_status,
                                     attempts, review_status, reviewed_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'rendered', $9, 1, 'verified', now())
         on conflict (code_hash) do update set code_hash = excluded.code_hash
         returning id, review_status`,
        [f.tool, f.code, f.code_hash, f.alt.slice(0, 400), f.png_path, f.width_px, f.height_px, f.bytes, f.vision],
      );
      if (fig.rows[0]?.review_status !== 'verified') throw new Error('şekil incelemede');
      await db.query('update public.questions set figure_id = $2::uuid where id = $1::uuid and figure_id is null', [q.id, fig.rows[0]!.id]);
    } catch (e) {
      // şekilsiz kalan şekilli soru öğrenciye gitmesin
      await db.query(`update public.questions set status = 'retired' where id = $1::uuid`, [q.id]);
      dropped.push({ no: 0, reason: `şekil bağlanamadı: ${(e as Error).message.slice(0, 120)}` });
    }
  }
  return { verify: checked.summary, registered: reg.inserted, reused: reg.reused, question_ids: tagged.rows.map((r) => String(r.id)), dropped };
}
