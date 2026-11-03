import { z } from 'zod';
import { uuid } from './schemas.js';
import type { JobDefinition } from './types.js';

const payload = z.object({
  /** Tek öğrenci; verilmezse hafızası olan tüm öğrenciler (gece çalışması). */
  studentId: uuid.optional(),
});

/**
 * İSKELET (P1+): gece hafıza sıkıştırma. Gerçek mantık `memory_compaction` rotasını Batch ile çağırır, çıktıyı
 * `memory_files`a `PgStore.write(..., 'compact', 'memory-compact')` ile yazar (sürüm satırıyla) ve dossier.render ekler.
 * Şimdilik yalnız hafızası olan öğrencileri sayar.
 */
export const memoryCompactJob: JobDefinition<z.infer<typeof payload>, { skeleton: true; students: number }> = {
  name: 'memory.compact',
  description: 'Gece hafıza sıkıştırma (iskelet): hafızası olan öğrencileri sayar.',
  process: 'worker',
  payload,
  concurrency: 1,
  retry: { retryLimit: 2, retryDelay: 60, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 1800, deleteAfterSeconds: 604_800 },
  skeleton: true,
  handler: async (p, ctx) => {
    const r = p.studentId
      ? await ctx.db.query('select count(distinct student_id)::int as n from public.memory_files where student_id = $1', [p.studentId])
      : await ctx.db.query('select count(distinct student_id)::int as n from public.memory_files');
    const students = Number(r.rows[0]?.n ?? 0);
    ctx.log.info('memory.compact iskelet', { students });
    return { skeleton: true, students };
  },
};
