import { z } from 'zod';
import { debounced } from './dedupe.js';
import { acceptCamelAliases, uuid } from './schemas.js';
import type { JobDefinition } from './types.js';

const payload = acceptCamelAliases(
  { studentId: 'student_id', enrollmentId: 'enrollment_id', courseId: 'course_id' },
  z.object({
    student_id: uuid,
    enrollment_id: uuid.optional(),
    course_id: uuid.optional(),
    /** Biten etkinlik: 'practice', 'diagnosis', 'exam', 'lesson', 'document', 'upload' … */
    kind: z.string().min(1).max(40),
  }),
);

export interface ActivityCompletedResult {
  enqueued: string[];
}

/**
 * Etkinlik bitti olayı (alıştırma, teşhis, deneme, ders, belge, yükleme): Bugün kartları (suggestions.refresh, öğrenci
 * başına 15 sn debounce) ve dersin dossier'i (dossier.render) yeniden kurulur. apps/web ve diğer işler etkinlik bitince bunu
 * kuyruğa atar; SQL tarafında finish_practice ve onboarding_enroll suggestions.refresh'i doğrudan ekler.
 */
export const activityCompletedJob: JobDefinition<z.infer<typeof payload>, ActivityCompletedResult> = {
  name: 'activity.completed',
  description: 'Etkinlik sonrası: suggestions.refresh + dossier.render.',
  process: 'worker',
  payload,
  concurrency: 4,
  retry: { retryLimit: 3, retryDelay: 5, retryBackoff: true, retryDelayMax: 120, expireInSeconds: 60, deleteAfterSeconds: 86_400 },
  handler: async (p, ctx) => {
    const enqueued: string[] = [];
    await ctx.enqueue('suggestions.refresh', { student_id: p.student_id, reason: p.kind }, debounced(`suggestions:${p.student_id}`));
    enqueued.push('suggestions.refresh');
    let course = p.course_id ?? null;
    if (!course && p.enrollment_id) {
      const r = await ctx.db.query('select course_id from public.enrollments where id = $1::uuid and student_id = $2::uuid', [p.enrollment_id, p.student_id]);
      course = r.rows[0]?.course_id ? String(r.rows[0].course_id) : null;
    }
    if (course) {
      await ctx.enqueue('dossier.render', { student_id: p.student_id, course_id: course }, debounced(`dossier:${p.student_id}:${course}`));
      enqueued.push('dossier.render');
    }
    return { enqueued };
  },
};
