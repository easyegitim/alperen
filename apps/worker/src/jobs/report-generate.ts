/**
 * `report.generate` {document_id} — velinin istediği rapor (parent_request_report, supabase 0043 atar). Ayrıntı:
 * src/reports/produce.ts (veri ve grafik verisi deterministik, report rotası, doc-render rapor şablonu → PDF → Storage →
 * register_generated_document rendered → report_ready bildirimi).
 */
import { z } from 'zod';
import { produceParentReport, type ParentReportOutcome } from '../reports/produce.js';
import { uuid } from './schemas.js';
import type { JobDefinition } from './types.js';

const payload = z
  .object({
    document_id: uuid,
    student_id: uuid.optional(),
    report_kind: z.string().max(20).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    requested_by: uuid.optional(),
  })
  .passthrough();

const RETRY = { retryLimit: 3, retryDelay: 30, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 900, deleteAfterSeconds: 604_800, retentionSeconds: 7 * 86_400 } as const;

export const reportGenerateJob: JobDefinition<z.infer<typeof payload>, ParentReportOutcome> = {
  name: 'report.generate',
  description: 'Veli raporu: report rotası (report-ast) → doc-render PDF → Storage → rendered → report_ready.',
  process: 'worker',
  payload,
  concurrency: 2,
  retry: RETRY,
  handler: async (p, ctx) => produceParentReport(ctx, p.document_id, { lastAttempt: ctx.job.retryCount >= RETRY.retryLimit }),
};
