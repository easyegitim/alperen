import { z } from 'zod';
import { renderDossierText } from '../dossier/text.js';
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
 * `render_dossier(p_student, p_course)` RPC'sini çağırır; dönen yapısal JSON'un `hash`i `student_dossier_cache`
 * satırındakiyle aynıysa dokunmaz (önbellek öneki değişmez), değilse metni üretip satırı günceller.
 */
export const dossierRenderJob: JobDefinition<z.infer<typeof payload>, DossierRenderResult> = {
  name: 'dossier.render',
  description: 'render_dossier RPC → metin → student_dossier_cache (hash değişince).',
  process: 'worker',
  payload,
  concurrency: 4,
  retry: { retryLimit: 3, retryDelay: 5, retryBackoff: true, retryDelayMax: 120, expireInSeconds: 120, deleteAfterSeconds: 86_400 },
  handler: async (p, ctx) => {
    let body: Record<string, unknown> | null;
    try {
      const r = await ctx.db.query('select public.render_dossier($1::uuid, $2::uuid) as dossier', [p.student_id, p.course_id]);
      const raw = r.rows[0]?.dossier;
      body = typeof raw === 'string' ? (JSON.parse(raw) as Record<string, unknown>) : ((raw as Record<string, unknown> | null) ?? null);
    } catch (err) {
      // OGR-DOS-001: öğrencinin bu derste kaydı yok → yeniden denemek anlamsız.
      if (/OGR-DOS-001/.test((err as Error).message)) throw new PermanentJobError((err as Error).message, 'OGR-DOS-001');
      throw err;
    }
    const hash = body && typeof body.hash === 'string' ? body.hash : null;
    if (!body || !hash) throw new Error('render_dossier hash döndürmedi');

    const cur = await ctx.db.query('select hash from public.student_dossier_cache where student_id = $1::uuid and course_id = $2::uuid', [
      p.student_id,
      p.course_id,
    ]);
    if (cur.rows[0]?.hash === hash) return { changed: false, hash, chars: 0 };

    const { hash: _h, ...structural } = body;
    const rendered = renderDossierText(structural);
    await ctx.db.query(
      `insert into public.student_dossier_cache (student_id, course_id, hash, rendered)
       values ($1::uuid, $2::uuid, $3, $4)
       on conflict (student_id, course_id) do update
         set hash = excluded.hash, rendered = excluded.rendered, updated_at = now()`,
      [p.student_id, p.course_id, hash, rendered],
    );
    ctx.log.info('dossier güncellendi', { hash: hash.slice(0, 12), chars: rendered.length });
    return { changed: true, hash, chars: rendered.length };
  },
};
