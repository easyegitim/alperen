/**
 * `style.question_gen` {style_id, enrollment_id?, count?, reason?} — tarza özel özgün soru üretimi (docs/PLAN-v2.md §11,
 * §7 doğrulama). style.coverage.refresh (bankası zayıf öncelikli tarzlar) ya da eğitmen/öneri akışı kuyruğa atar.
 *
 *   1. Tarz + ders + müfredat; tarzın yaprak kazanımları (yoksa maddelerinin en sık yaprağı). Emekli tarz atlanır.
 *   2. Girdi: tarzın adı, tanımı, biçimi, tuzağı, zorluk bandı; örnek maddelerin YALNIZ yapısı (yıl, tür, biçim, konu,
 *      tuzak, zorluk, puan; çıkmış soru metni gönderilmez) ve bankadaki köklerin kısaltılmışı (yinelenmesin).
 *      Dönen kök/şık arşiv metninden (exam_items.ocr_text) 30+ karakter aynen taşıyorsa madde atılır (telif).
 *   3. style_question_gen (Opus; figür yerelde ya da code_execution konteynerinde) → yapı denetimi → SymPy anahtar
 *      denetimi (py/key_verify.py) → yalnız doğrulananlar register_practice_questions ile bankaya (approved), style_id ve
 *      şekil bağlanır (styles/bank.ts). Şekilli soru yalnız Storage varken (PNG figures kovasına) girer.
 *   4. enrollment_id verildiyse öğrencinin Bugün kartları yenilenir (suggestions.refresh).
 * Gerçek taşımada ücretli çağrı check_spend('style.question_gen') ile denetlenir; kapalıysa iş atlanır.
 */
import { z } from 'zod';
import { collectOutputFiles, type Gateway } from '@ogrenmen/llm';
import { downloadedFigures } from '../documents/figures.js';
import { pythonKeyVerifier, type KeyVerifier } from '../practice/bank.js';
import { systemPrompt } from '../prompts.js';
import type { StorageLike } from '../storage.js';
import { mapStyleItems, renderStyleFigures, writeStyleQuestions } from '../styles/bank.js';
import { loadStyle, skillNames } from '../styles/db.js';
import { generateStyleQuestions, type StyleCallEnv } from '../styles/llm.js';
import { debounced } from './dedupe.js';
import { figuresMode } from './document-generate.js';
import { PermanentJobError } from './errors.js';
import { uuid } from './schemas.js';
import type { JobContext, JobDefinition } from './types.js';

export const STYLE_GEN_DEFAULT_COUNT = 5;

const payload = z
  .object({
    style_id: uuid,
    enrollment_id: uuid.nullish(),
    count: z.number().int().min(1).max(10).default(STYLE_GEN_DEFAULT_COUNT),
    reason: z.string().max(64).nullish(),
  })
  .passthrough();
export type StyleQuestionGenPayload = z.infer<typeof payload>;

/** Testler anahtar doğrulayıcısını değiştirebilir (Python'suz birim testleri). */
export const styleGenHooks: { keyVerifier?: KeyVerifier; visionCheck?: boolean } = {};

export interface StyleQuestionGenResult {
  style_id: string;
  status: 'generated' | 'skipped';
  reason?: string;
  requested?: number;
  returned?: number;
  verified?: number;
  inserted?: number;
  reused?: number;
  question_ids?: string[];
  dropped?: { no: number; reason: string }[];
  cost_usd?: number;
}

function safeStorage(ctx: JobContext): StorageLike | null {
  try {
    return ctx.storage();
  } catch {
    return null;
  }
}

async function paidAllowed(ctx: JobContext, gateway: Gateway): Promise<{ ok: boolean; state: string | null }> {
  if (gateway.transport.kind === 'fake') return { ok: true, state: null };
  const r = await ctx.db.query(`select paid_allowed, state from public.check_spend('style.question_gen')`).catch(() => ({ rows: [] as Record<string, unknown>[] }));
  const row = r.rows[0] as { paid_allowed?: boolean; state?: string } | undefined;
  return { ok: !row || row.paid_allowed !== false, state: row?.state ?? null };
}

export async function runStyleQuestionGen(p: StyleQuestionGenPayload, ctx: JobContext): Promise<StyleQuestionGenResult> {
  const style = await loadStyle(ctx.db, p.style_id);
  if (!style) throw new PermanentJobError(`tarz yok: ${p.style_id}`, 'OGR-JOB-175');
  const skip = (reason: string): StyleQuestionGenResult => ({ style_id: style.id, status: 'skipped', reason });
  if (style.status === 'retired') return skip('retired');
  if (!style.curriculum_id) return skip('no_curriculum');

  const sk = await skillNames(ctx.db, style.curriculum_id);
  let leaves = style.skill_ids.filter((s) => sk.get(s)?.leaf);
  if (leaves.length === 0) {
    const r = await ctx.db.query(
      `select x.sid, count(*) as n from public.exam_items ei cross join unnest(ei.skill_ids) as x (sid)
        where ei.style_id = $1::uuid group by x.sid order by n desc, x.sid limit 3`,
      [style.id],
    );
    leaves = r.rows.map((x) => String(x.sid)).filter((s) => sk.get(s)?.leaf);
  }
  if (leaves.length === 0) return skip('no_skills');

  const gateway = await ctx.gateway();
  const spend = await paidAllowed(ctx, gateway);
  if (!spend.ok) return skip(`spend_${spend.state ?? 'blocked'}`);

  const [course, exemplars, avoid, student, archive] = await Promise.all([
    ctx.db.query('select title from public.courses where id = $1::uuid', [style.course_id]),
    ctx.db.query(
      `select coalesce(ei.year, s.year) as year, ei.kind, ei.format, ei.topic, ei.trick, ei.difficulty::float8 as difficulty, ei.points::float8 as points
         from public.exam_items ei join public.exam_sources s on s.id = ei.source_id
        where ei.style_id = $1::uuid and s.status <> 'failed'
        order by array_position($2::uuid[], ei.id) nulls last, coalesce(ei.year, s.year) desc, ei.item_no limit 6`,
      [style.id, style.exemplar_item_ids],
    ),
    ctx.db.query(`select q.stem from public.questions q where q.style_id = $1::uuid and q.status = 'approved' order by q.created_at desc limit 20`, [style.id]),
    p.enrollment_id
      ? ctx.db.query('select e.student_id, st.public_ref from public.enrollments e join public.students st on st.id = e.student_id where e.id = $1::uuid', [p.enrollment_id])
      : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    // kopya denetimi için arşiv metni (tarzın maddeleri önce, sonra dersin kalanı); modele gönderilmez
    ctx.db.query(
      `select ei.ocr_text from public.exam_items ei join public.exam_sources s on s.id = ei.source_id
        where (ei.style_id = $1::uuid or s.course_id = $2::uuid) and length(ei.ocr_text) >= 30
        order by (ei.style_id = $1::uuid) desc nulls last, coalesce(ei.year, s.year) desc nulls last, ei.id limit 1000`,
      [style.id, style.course_id],
    ),
  ]);
  const studentId = student.rows[0] ? String(student.rows[0].student_id) : null;
  const env: StyleCallEnv = {
    db: ctx.db, gateway, courseId: style.course_id, curriculumId: style.curriculum_id, ref: { table: 'question_styles', id: style.id },
    studentRef: student.rows[0] ? String(student.rows[0].public_ref) : null, purpose: 'style.question_gen', now: ctx.now, signal: ctx.signal,
  };
  const mode = figuresMode(ctx.config.figures, gateway);
  const gen = await generateStyleQuestions(
    env,
    {
      style: { id: style.id, code: style.code, name: style.name, description: style.description, format: style.format, trick: style.trick, difficulty_band: style.difficulty_band },
      count: p.count,
      skills: leaves.map((id) => ({ id, name: sk.get(id)?.name ?? id, description: sk.get(id)?.description ?? null })),
      exemplars: exemplars.rows.map((x) => ({
        year: x.year === null ? null : Number(x.year), kind: String(x.kind), format: x.format === null ? null : String(x.format),
        topic: x.topic === null ? null : String(x.topic), trick: x.trick === null ? null : String(x.trick),
        difficulty: x.difficulty === null ? null : Number(x.difficulty), points: x.points === null ? null : Number(x.points),
      })),
      avoidStems: avoid.rows.map((x) => String(x.stem)),
      courseTitle: course.rows[0]?.title ? String(course.rows[0].title) : null,
    },
    { localFigures: mode === 'local' },
  );
  const prompt = await systemPrompt(ctx.db, 'style_question_gen');
  // tek tarz istendi: model başka kimlik yazsa da sorular bu tarzındır
  const data = { ...gen.data, items: gen.data.items.map((it) => ({ ...it, style_id: style.id })) };
  const mapped = mapStyleItems(data, {
    curriculumId: style.curriculum_id, styleId: style.id, leaves, model: gen.model, costUsd: gen.costUsd, promptVersion: prompt.version,
    jobRef: `style.question_gen:${ctx.job.id}`, remapForeignSkills: gateway.transport.kind === 'fake',
    sources: archive.rows.map((x) => String(x.ocr_text)),
  });
  const remote = mode === 'code_execution'
    ? await downloadedFigures(gateway, collectOutputFiles(gen.transcript), mapped.items.filter((i) => i.figureCode?.kind === 'matplotlib').map((i) => ({
        block_id: i.content_hash, question_no: i.figureCode!.no, kind: 'matplotlib' as const, code: i.figureCode!.code, file_name: `figure_${i.figureCode!.no}.svg`, alt: i.figureCode!.alt, context: i.stem, hidden: [],
      }))).catch(() => new Map<string, string>())
    : new Map<string, string>();
  const figPrompt = await systemPrompt(ctx.db, 'figure_check');
  const figs = await renderStyleFigures(mapped.items, {
    db: ctx.db, gateway, storage: safeStorage(ctx), mode, remote,
    figureEnv: { prompt: { text: figPrompt.text, version: figPrompt.version }, ref: env.ref, studentRef: env.studentRef, signal: ctx.signal, ...(styleGenHooks.visionCheck === false ? { visionCheck: false } : {}) },
  });
  const written = await writeStyleQuestions(ctx.db, {
    curriculumId: style.curriculum_id, styleId: style.id, items: figs.items, figures: figs.figures,
    verifier: styleGenHooks.keyVerifier ?? pythonKeyVerifier, signal: ctx.signal,
  });
  if (studentId) {
    await ctx.enqueue('suggestions.refresh', { student_id: studentId, reason: 'style.question_gen' }, debounced(`suggestions:${studentId}`)).catch(() => null);
  }
  const res: StyleQuestionGenResult = {
    style_id: style.id, status: 'generated', requested: p.count, returned: gen.data.items.length, verified: written.verify.verified,
    inserted: written.registered, reused: written.reused, question_ids: written.question_ids,
    dropped: [...mapped.dropped, ...figs.dropped, ...written.dropped], cost_usd: Number((gen.costUsd + figs.costUsd).toFixed(6)),
  };
  ctx.log.info('style.question_gen: tarz soruları üretildi', { style: style.id, reason: p.reason ?? null, returned: res.returned, verified: res.verified, inserted: res.inserted, dropped: res.dropped?.length ?? 0 });
  return res;
}

export const styleQuestionGenJob: JobDefinition<StyleQuestionGenPayload, StyleQuestionGenResult> = {
  name: 'style.question_gen',
  description: 'Tarza özel özgün soru üretimi (Opus; SymPy anahtar denetimi; yalnız doğrulananlar style_id ile alıştırma bankasına).',
  process: 'worker',
  payload,
  concurrency: 2,
  retry: { retryLimit: 2, retryDelay: 60, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 900, deleteAfterSeconds: 7 * 86_400 },
  handler: runStyleQuestionGen,
};
