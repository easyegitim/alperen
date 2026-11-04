/**
 * İş kayıt defteri: ad → { yük şeması, eşzamanlılık, yeniden deneme politikası, işleyici }.
 * Tek doğruluk kaynağı; app.ts bunlardan pg-boss kuyruklarını açar ve işçileri bağlar.
 * SQL tarafı (`public.enqueue_job(name, data)`, supabase/migrations/0016) aynı adları kullanır; kuyruk önceden
 * açık olmalıdır, bu yüzden işleyicisi henüz olmayan SQL iş adları da buraya `handler: null` ile yazılır.
 */
import { z } from 'zod';
import { activityCompletedJob } from './activityCompleted.js';
import { conversationSummarizeJob } from './conversationSummarize.js';
import { curriculumDraftJob } from './curriculum-draft.js';
import { curriculumMergeJob, proposalsCollectJob, proposalsReviewJob } from './curriculum-proposals.js';
import { diagnosisRunJob } from './diagnosis.js';
import { diagnosisFollowupJob } from './diagnosisFollowup.js';
import { documentGenerateJob } from './document-generate.js';
import { dossierRenderJob } from './dossierRender.js';
import { examAnalyseJob } from './exam-analyse.js';
import { examReportJob } from './exam-report.js';
import { llmPingJob } from './llmPing.js';
import { memoryCompactJob } from './memoryCompact.js';
import { noopJob } from './noop.js';
import { outboxDrainJob } from './outboxDrain.js';
import { practiceGenerateJob, practicePrewarmJob } from './practice-generate.js';
import { pdfRenderJob } from './pdfRender.js';
import { pushSendJob } from './pushSend.js';
import { suggestionsRefreshJob } from './suggestionsRefresh.js';
import type { AnyJobDefinition, JobDefinition, QueuePolicy } from './types.js';
import { uploadIntakeJob } from './upload-intake.js';
import { weeklySummaryJob } from './weeklySummary.js';

/** Dead letter kuyruğu: yeniden denemeleri biten ve kalıcı hata veren işler buraya kopyalanır. */
export const DEAD_LETTER_QUEUE = 'dead_letter';

const uuid = z.string().uuid();

const PENDING_RETRY: QueuePolicy = { retryLimit: 3, retryDelay: 30, retryBackoff: true, retryDelayMax: 900, expireInSeconds: 900, deleteAfterSeconds: 604_800, retentionSeconds: 90 * 86_400 };

/** RPC'lerin (0017_rpc.sql) kuyruğa attığı (yük anahtarları snake_case: SQL sözleşmesi), işleyicisi sonraki aşamalarda gelen işler. */
function pending(name: string, description: string, payload: z.ZodType<object>): JobDefinition<object, never> {
  return { name, description, process: 'worker', payload, concurrency: 1, retry: PENDING_RETRY, handler: null, skeleton: true };
}

export const JOBS: readonly AnyJobDefinition[] = [
  noopJob,
  llmPingJob,
  memoryCompactJob,
  dossierRenderJob,
  pdfRenderJob,
  pushSendJob,
  weeklySummaryJob,
  suggestionsRefreshJob,
  activityCompletedJob,
  conversationSummarizeJob,
  uploadIntakeJob,
  diagnosisRunJob,
  diagnosisFollowupJob,
  // submit_exam_upload (0030) ve upload.intake school_exam atar; grade_exam_session exam.report atar
  examAnalyseJob,
  examReportJob,
  // request_document (0034) atar: not / deneme / soru seti üretimi + doğrulama merdiveni
  documentGenerateJob,
  // start_practice (0021) bankada soru yoksa practice.generate atar; ön ısıtma curriculum.draft ve suggestions.refresh'ten
  practiceGenerateJob,
  practicePrewarmJob,
  // 0023 RPC'lerinin kuyruğa attığı işler (kuyruk açık değilse enqueue_job düşer, iş kaybolur); işleyiciler P1'de
  pending('memory.correction', 'Hafıza düzeltme isteği (P1): request_memory_correction ekler.', z.object({ correction_id: uuid, student_id: uuid }).passthrough()),
  curriculumDraftJob,
  curriculumMergeJob,
  proposalsReviewJob,
  proposalsCollectJob,
  // secure.job_outbox (0029): enqueue_job'un pgboss'a yazamadığı işler; worker her 30 sn aktarır
  outboxDrainJob,
];

const BY_NAME = new Map(JOBS.map((j) => [j.name, j]));

export function getJob(name: string): AnyJobDefinition | undefined {
  return BY_NAME.get(name);
}

export function jobNames(): string[] {
  return JOBS.map((j) => j.name);
}

/** Süreçte çalıştırılacak tanımlar: `all` hepsi, `worker`/`pdf` yalnız kendi işleri. */
export function jobsForProcess(proc: 'worker' | 'pdf' | 'all'): AnyJobDefinition[] {
  return JOBS.filter((j) => proc === 'all' || j.process === proc);
}

/** Kayıt defteri tutarlılığı (testler ve açılışta denetlenir); sorunları metin olarak döner. */
export function validateRegistry(defs: readonly AnyJobDefinition[] = JOBS): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const j of defs) {
    if (seen.has(j.name)) problems.push(`yinelenen iş adı: ${j.name}`);
    seen.add(j.name);
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$|^noop$/.test(j.name)) problems.push(`${j.name}: ad 'modül.eylem' biçiminde olmalı`);
    if (j.name === DEAD_LETTER_QUEUE) problems.push(`${j.name}: dead letter adı ayrılmış`);
    if (j.retry.retryLimit < 0 || j.retry.retryDelay < 0 || j.retry.expireInSeconds < 1) problems.push(`${j.name}: geçersiz yeniden deneme politikası`);
    if (j.retry.retryBackoff && j.retry.retryLimit === 0) problems.push(`${j.name}: retryBackoff için retryLimit > 0 olmalı`);
    if (typeof j.concurrency === 'number' && (j.concurrency < 1 || j.concurrency > 16)) problems.push(`${j.name}: eşzamanlılık 1..16 olmalı`);
  }
  return problems;
}
