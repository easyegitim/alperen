import { z } from 'zod';
import { applyMemoryDelta, createMemoryHandlers, MEMORY_DELTA_ACTOR, MemoryError, PgStore, runMemoryCommand, type MemoryDeltaOp } from '@ogrenmen/llm';
import { systemPrompt } from '../prompts.js';
import { PermanentJobError } from './errors.js';
import { uuid } from './schemas.js';
import type { JobDefinition } from './types.js';

const payload = z.object({ analysis_id: uuid, enrollment_id: uuid });

export interface DiagnosisFollowupResult {
  analysisId: string;
  memory: { called: boolean; applied: number; failed: number };
  enqueued: string[];
}

/** Teşhis metninden modele giden alanlar (öğrenci çözüm metni ve görsel yok). */
const ANALYSIS_MAX_CHARS = 4000;
/** Bu hükümlerde hafıza deltası çağrılmaz (prompt: doğru çözüm genellikle işlem gerektirmez; okunamayan teşhis kanıt değildir). */
const SKIP_DELTA = new Set(['correct', 'unreadable']);

/**
 * Teşhis sonrası (apply_diagnosis RPC'si kuyruğa atar): Haiku `memory_delta` → `applyMemoryDelta` (hafıza aracının
 * aynı işleyicileri; patterns.md / courses/<kod>.md, en çok 3 işlem) → `activity.completed` (Bugün kartları + dossier).
 */
export const diagnosisFollowupJob: JobDefinition<z.infer<typeof payload>, DiagnosisFollowupResult> = {
  name: 'diagnosis.followup',
  description: 'Teşhis sonrası: memory_delta (Haiku) → hafıza işleyicileri → activity.completed.',
  process: 'worker',
  payload,
  concurrency: 2,
  retry: { retryLimit: 3, retryDelay: 20, retryBackoff: true, retryDelayMax: 600, expireInSeconds: 180, deleteAfterSeconds: 86_400 },
  handler: async (p, ctx) => {
    const r = await ctx.db.query(
      `select sa.id, sa.verdict, sa.error_cause, sa.failing_step_no, sa.skill_ids, sa.misconception_tags, sa.analysis,
              e.student_id, e.course_id, co.code as course_code, st.public_ref
         from public.solution_analyses sa
         join public.enrollments e on e.id = sa.enrollment_id
         join public.students st on st.id = e.student_id
         left join public.courses co on co.id = e.course_id
        where sa.id = $1::uuid and sa.enrollment_id = $2::uuid`,
      [p.analysis_id, p.enrollment_id],
    );
    const a = r.rows[0];
    if (!a) throw new PermanentJobError(`teşhis yok: ${p.analysis_id}`, 'OGR-JOB-130');
    const studentId = String(a.student_id);
    const memory = { called: false, applied: 0, failed: 0 };

    if (!SKIP_DELTA.has(String(a.verdict))) {
      const store = new PgStore(ctx.db);
      const viewer = createMemoryHandlers({ store, studentId, actor: MEMORY_DELTA_ACTOR, readOnly: true });
      const paths = ['/memories/patterns.md', ...(a.course_code ? [`/memories/courses/${String(a.course_code).replace(/[^A-Za-z0-9_-]/g, '-')}.md`] : [])];
      const files: { path: string; exists: boolean; view: string | null }[] = [];
      for (const path of paths) {
        try {
          files.push({ path, exists: true, view: await runMemoryCommand(viewer, { command: 'view', path }) });
        } catch (err) {
          if (!(err instanceof MemoryError)) throw err;
          files.push({ path, exists: false, view: null });
        }
      }
      const analysisText = JSON.stringify(a.analysis ?? {});
      const system = await systemPrompt(ctx.db, 'memory_delta');
      const gateway = await ctx.gateway();
      const res = await gateway.call('memory_delta', {
        system: { product: system.text },
        user: JSON.stringify({
          diagnosis: {
            verdict: a.verdict,
            error_cause: a.error_cause ?? null,
            failing_step_no: a.failing_step_no ?? null,
            skill_ids: a.skill_ids ?? [],
            misconception_tags: a.misconception_tags ?? [],
            analysis: analysisText.length > ANALYSIS_MAX_CHARS ? `${analysisText.slice(0, ANALYSIS_MAX_CHARS)}…` : JSON.parse(analysisText),
          },
          files,
        }),
        turn: { now: ctx.now() },
        promptVersion: system.version,
        studentRef: String(a.public_ref),
        ref: { table: 'solution_analyses', id: p.analysis_id },
        purpose: 'diagnosis.followup',
        signal: ctx.signal,
      });
      const ops = ((res.data as { ops?: MemoryDeltaOp[] } | null)?.ops ?? []) as MemoryDeltaOp[];
      const out = await applyMemoryDelta({ store, studentId, actor: MEMORY_DELTA_ACTOR }, ops);
      memory.called = true;
      memory.applied = out.applied;
      memory.failed = out.failed;
      if (out.failed) ctx.log.warn('memory_delta işlemleri düştü', { codes: out.results.filter((x) => !x.ok).map((x) => x.code) });
    }

    await ctx.enqueue('activity.completed', {
      student_id: studentId,
      enrollment_id: p.enrollment_id,
      ...(a.course_id ? { course_id: String(a.course_id) } : {}),
      kind: 'diagnosis',
    });
    return { analysisId: p.analysis_id, memory, enqueued: ['activity.completed'] };
  },
};
