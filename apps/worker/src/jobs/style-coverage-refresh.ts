/**
 * `style.coverage.refresh` {course_id, reason?} — tarz kütüphanesi değişince dersin öğrencileri (P4, docs/PLAN-v2.md §11).
 * style.ingest sonunda (ders başına 60 sn debounce) kuyruğa atılır.
 *
 *   1. Kapsama kendisi türetilmiştir (0036 tetikleyicileri: denemeler, deneme yanıtları, teşhisler); bu iş dersin etkin
 *      kayıtlarının özetini (public.student_style_coverage) günlüğe yazar ve her öğrencinin Bugün kartlarını yeniler
 *      (suggestions.refresh; "Bu tarzı hiç çözmedin" kuralı suggestions/styles.ts).
 *   2. Tarz bankası ön ısıtma: sorulmuş (yılı olan), emekli olmayan tarzlardan öncelik skoru en yüksek PREWARM_STYLES
 *      tanesinin onaylı tarz sorusu PREWARM_MIN'in altındaysa 'style.question_gen' (tarz başına 6 saatte bir).
 * Ücretli çağrı yapmaz (üretim kendi işinde check_spend ile denetlenir).
 */
import { z } from 'zod';
import { debounced, oncePer } from './dedupe.js';
import { uuid } from './schemas.js';
import { STYLE_GEN_DEFAULT_COUNT } from './style-question-gen.js';
import type { JobContext, JobDefinition } from './types.js';

export const PREWARM_STYLES = 3;
export const PREWARM_MIN = 5;

const payload = z.object({ course_id: uuid, reason: z.string().max(64).nullish() }).passthrough();
export type StyleCoverageRefreshPayload = z.infer<typeof payload>;

export interface StyleCoverageRefreshResult {
  course_id: string;
  enrollments: number;
  students_refreshed: number;
  never_solved: Record<string, number>;
  generation_enqueued: string[];
}

export async function runStyleCoverageRefresh(p: StyleCoverageRefreshPayload, ctx: JobContext): Promise<StyleCoverageRefreshResult> {
  const enr = await ctx.db.query(
    `select e.id, e.student_id from public.enrollments e join public.students s on s.id = e.student_id
      where e.course_id = $1::uuid and e.status = 'active' and s.status = 'active' order by e.id`,
    [p.course_id],
  );
  const neverSolved: Record<string, number> = {};
  const students = new Set<string>();
  for (const row of enr.rows) {
    const id = String(row.id);
    const cov = await ctx.db.query('select public.student_style_coverage($1::uuid) as c', [id]);
    neverSolved[id] = Number((cov.rows[0]?.c as { summary?: { never_solved?: number } } | undefined)?.summary?.never_solved ?? 0);
    students.add(String(row.student_id));
  }
  for (const s of students) {
    await ctx.enqueue('suggestions.refresh', { student_id: s, reason: 'style.coverage' }, debounced(`suggestions:${s}`)).catch((err: unknown) =>
      ctx.log.warn('suggestions.refresh kuyruğa atılamadı', { student: s, error: (err as Error).message }),
    );
  }

  const warm = await ctx.db.query(
    `select qs.id,
            (select count(*) from public.questions q where q.style_id = qs.id and q.status = 'approved')::int as bank
       from public.question_styles qs
      where qs.course_id = $1::uuid and qs.status <> 'retired' and cardinality(qs.years_hit) > 0
      order by qs.priority_score desc nulls last, qs.code
      limit $2`,
    [p.course_id, PREWARM_STYLES],
  );
  const enqueued: string[] = [];
  for (const row of warm.rows) {
    if (Number(row.bank) >= PREWARM_MIN) continue;
    const id = String(row.id);
    const job = await ctx
      .enqueue('style.question_gen', { style_id: id, count: STYLE_GEN_DEFAULT_COUNT, reason: 'prewarm' }, oncePer(`style-gen:${id}`, 6 * 3600))
      .catch((err: unknown) => {
        ctx.log.warn('style.question_gen kuyruğa atılamadı', { style: id, error: (err as Error).message });
        return null;
      });
    if (job) enqueued.push(id);
  }
  ctx.log.info('style.coverage.refresh', { course: p.course_id, reason: p.reason ?? null, enrollments: enr.rows.length, students: students.size, generation: enqueued.length });
  return { course_id: p.course_id, enrollments: enr.rows.length, students_refreshed: students.size, never_solved: neverSolved, generation_enqueued: enqueued };
}

export const styleCoverageRefreshJob: JobDefinition<StyleCoverageRefreshPayload, StyleCoverageRefreshResult> = {
  name: 'style.coverage.refresh',
  description: 'Tarz kütüphanesi değişince: dersin öğrencilerinin Bugün kartları + öncelikli tarzların soru bankası ön ısıtması.',
  process: 'worker',
  payload,
  concurrency: 2,
  retry: { retryLimit: 3, retryDelay: 30, retryBackoff: true, retryDelayMax: 600, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
  handler: runStyleCoverageRefresh,
};
