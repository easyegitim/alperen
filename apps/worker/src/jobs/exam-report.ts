/**
 * `exam.report` — notlanmış deneme oturumunun raporu. `grade_exam_session` her notlamada kuyruğa atar
 * ({session_id}). Yüklenen denemede raporu `exam.analyse` kendisi üretir (aynı işin içinde, notlamanın hemen ardından);
 * bu iş yalnız uygulama içi (`in_app`) oturumlar içindir: exam/produce-report.ts (exam_report → PDF → Storage →
 * register_generated_document → done) + veli bildirimi. Rapor zaten bağlıysa ya da oturum notlanmamışsa iş biter.
 */
import { z } from 'zod';
import { loadSession, notifyParents } from '../exam/db.js';
import { produceReport } from '../exam/produce-report.js';
import { PermanentJobError } from './errors.js';
import { uuid } from './schemas.js';
import type { JobDefinition } from './types.js';

const payload = z.object({ session_id: uuid });

export interface ExamReportResult {
  sessionId: string;
  skipped?: 'uploaded' | 'finished' | 'not_graded';
  documentId?: string | null;
  status?: string;
  fallback?: boolean;
}

export const examReportJob: JobDefinition<z.infer<typeof payload>, ExamReportResult> = {
  name: 'exam.report',
  description: 'Deneme raporu (uygulama içi oturum): exam_report → doc-render PDF → Storage → register_generated_document.',
  process: 'worker',
  payload,
  concurrency: 2,
  retry: { retryLimit: 3, retryDelay: 30, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 900, deleteAfterSeconds: 604_800, retentionSeconds: 7 * 86_400 },
  handler: async (p, ctx) => {
    const s = await loadSession(ctx.db, p.session_id);
    if (!s) throw new PermanentJobError(`deneme oturumu bulunamadı: ${p.session_id}`, 'OGR-JOB-150');
    if (s.mode === 'uploaded') return { sessionId: s.id, skipped: 'uploaded' };
    if (s.status === 'done') return { sessionId: s.id, skipped: 'finished' };
    if (s.status !== 'analysing') return { sessionId: s.id, skipped: 'not_graded' };
    const rep = await produceReport(ctx, s, { lastAttempt: ctx.job.retryCount >= examReportJob.retry.retryLimit });
    await notifyParents(ctx.db, s, rep.parentLine, rep.documentId);
    return { sessionId: s.id, documentId: rep.documentId, status: rep.status, fallback: rep.fallback };
  },
};
