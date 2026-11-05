/**
 * Deneme analizinin aşama makinesi (exam_sessions.progress.stage; set_exam_progress RPC'si yazar, web yoklar):
 *
 *   classify → ocr → key → grade → analyse → report → done        (hata: failed)
 *
 *   classify  sayfa alımı (EXIF, eğrilik, ≤ 2576 px) + page_class (Haiku, paralel)       pages_total, pages_done
 *   ocr       kitapçık sayfaları exam_page_items (Sonnet, 6 paralel) + birleştirme + kırpım booklet_total, booklet_done, questions
 *   key       anahtar: yüklenen anahtar sayfası > yayıncı eşleşmesi > çıkarım (Opus)      key_source, keyed, key_unverified
 *   grade     optik form (answer_sheet) → record_exam_answers → grade_exam_session        answers_read, answers_double
 *   analyse   grade_exam_session yazar (status analysing; questions, wrong_blank)
 *   report    exam_report (Sonnet) → doc-render PDF → Storage → register_generated_document
 *   done      register_generated_document (rapor hazır) ya da rapor düşünce set_exam_progress('done')
 *
 * Yeniden deneme aşamaları baştan koşar ama her ücretli adımın çıktısı stash'tedir (exam/stash.ts): tekrar ücret yok.
 * Oturum durumu nereden başlanacağını söyler: grading → classify, analysing (notlu) → report, done/failed → bitmiş;
 * P1'in notsuz 'analysing' kaydı (eski upload.intake) sürülmez.
 */
export const EXAM_STAGES = ['classify', 'ocr', 'key', 'grade', 'analyse', 'report', 'done'] as const;
export type ExamStage = (typeof EXAM_STAGES)[number] | 'failed';

export type SessionStatus = 'in_progress' | 'grading' | 'analysing' | 'done' | 'failed' | string;

export interface ResumePlan {
  /** İlk koşulacak aşama; null: yapılacak iş yok. */
  from: ExamStage | null;
  reason: 'fresh' | 'graded' | 'unfinished' | 'finished' | 'failed' | 'not_uploaded' | 'legacy';
}

/**
 * Oturumun durumundan hattın nereden süreceği (saf; testli). `done` oturum, son yazımı (progress.diagnoses_queued: kart,
 * veli bildirimi ve teşhis dağıtımından sonra) yoksa yarım kalmıştır: rapordan sürer (rapor belgesi yeniden üretilmez).
 */
export function resumePlan(s: { mode: string; status: SessionStatus; graded?: boolean; progress?: Record<string, unknown> }): ResumePlan {
  if (s.mode !== 'uploaded') return { from: null, reason: 'not_uploaded' };
  if (s.status === 'done') return s.progress && !('diagnoses_queued' in s.progress) ? { from: 'report', reason: 'unfinished' } : { from: null, reason: 'finished' };
  if (s.status === 'failed') return { from: null, reason: 'failed' };
  // P1 upload.intake oturumu (analysing ama notsuz, sorusuz): hat bunu süremez
  if (s.status === 'analysing') return s.graded === false ? { from: null, reason: 'legacy' } : { from: 'report', reason: 'graded' };
  return { from: 'classify', reason: 'fresh' };
}

/** `a` aşaması `b`'den önce mi (failed sırasızdır). */
export function stageBefore(a: ExamStage, b: ExamStage): boolean {
  const ia = EXAM_STAGES.indexOf(a as (typeof EXAM_STAGES)[number]);
  const ib = EXAM_STAGES.indexOf(b as (typeof EXAM_STAGES)[number]);
  return ia >= 0 && ib >= 0 && ia < ib;
}

/** Bu plan `stage` aşamasını koşar mı. */
export function runsStage(plan: ResumePlan, stage: ExamStage): boolean {
  return plan.from !== null && (plan.from === stage || stageBefore(plan.from, stage));
}

/** Uyarı kodları (progress.warnings virgüllü metin; ayrıntı stash 'warnings'). */
export const WARNING_CODES = [
  'page_unreadable',
  'page_unknown',
  'question_partial',
  'question_duplicate',
  'question_gap',
  'skill_untagged',
  'key_low_confidence',
  'key_missing',
  'answer_double',
  'answer_unclear',
  'answer_low_confidence',
  'score_mismatch',
  'report_fallback',
  'report_failed',
  'no_scratch',
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

/** Kod listesini progress'e yazılacak tek metne çevirir (set_exam_progress düz değer ister). */
export function warningsText(codes: Iterable<WarningCode>): string {
  return [...new Set(codes)].sort().join(',');
}
