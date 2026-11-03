import { z } from 'zod';
import { DossierError, renderDossier } from '@ogrenmen/llm';
import { PermanentJobError } from './errors.js';
import { acceptCamelAliases, uuid } from './schemas.js';
import type { JobDefinition } from './types.js';

const payload = acceptCamelAliases({ studentId: 'student_id', courseId: 'course_id' }, z.object({ student_id: uuid, course_id: uuid }));

export interface DossierRenderResult {
  changed: boolean;
  hash: string;
  chars: number;
}

/**
 * `render_dossier(p_student, p_course)` → deterministik metin (packages/llm `renderDossier`) → `student_dossier_cache`.
 * Metnin hash'i satırdakiyle aynıysa dokunmaz (önbellek öneki değişmez), değilse satırı günceller.
 */
export const dossierRenderJob: JobDefinition<z.infer<typeof payload>, DossierRenderResult> = {
  name: 'dossier.render',
  description: 'render_dossier RPC → metin → student_dossier_cache (hash değişince).',
  process: 'worker',
  payload,
  concurrency: 4,
  retry: { retryLimit: 3, retryDelay: 5, retryBackoff: true, retryDelayMax: 120, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  handler: async (p, ctx) => {
    try {
      const d = await renderDossier(ctx.db, p.student_id, p.course_id);
      if (d.changed) ctx.log.info('dossier güncellendi', { hash: d.hash.slice(0, 12), chars: d.text.length });
      return { changed: d.changed, hash: d.hash, chars: d.changed ? d.text.length : 0 };
    } catch (err) {
      // OGR-DOS-001: öğrencinin bu derste kaydı yok → yeniden denemek anlamsız.
      if (err instanceof DossierError && err.code !== 'OGR-DOS-002') throw new PermanentJobError(err.message, err.code);
      if (/OGR-DOS-001/.test((err as Error).message ?? '')) throw new PermanentJobError((err as Error).message, 'OGR-DOS-001');
      throw err;
    }
  },
};
