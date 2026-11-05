// Uygulama içi sınav RPC'lerinin yanıt biçimleri (supabase/migrations/0031_exam_inapp.sql). Doğru cevap hiçbir yanıtta
// yoktur; burada da tutulmaz.
import { z } from 'zod';

const answerSchema = z.object({
  exam_question_id: z.string(),
  no: z.number().int(),
  answer: z.string().nullable().optional(),
  flagged: z.boolean().default(false),
  has_work: z.boolean().default(false),
});

/** app.exam_player_state: sunucu saati, bitiş sınırı ve verilmiş cevaplar. */
export const playerStateSchema = z.object({
  session_id: z.string(),
  exam_id: z.string(),
  enrollment_id: z.string(),
  title: z.string(),
  mode: z.string().optional(),
  status: z.string(),
  started_at: z.string(),
  server_now: z.string(),
  duration_min: z.number().nullable().optional(),
  deadline_at: z.string().nullable().optional(),
  remaining_sec: z.number().nullable().optional(),
  expired: z.boolean().default(false),
  question_count: z.number().int(),
  sections: z.array(z.unknown()).default([]),
  answers: z.array(answerSchema).default([]),
});
export type ExamPlayerState = z.infer<typeof playerStateSchema>;
export const parsePlayerState = (raw: unknown): ExamPlayerState => playerStateSchema.parse(raw);

/** exam_clock (0033): oturumun durumu, bitiş sınırı ve sunucu saati. Salt okur; yeni oturum açmaz. */
export const examClockSchema = z.object({
  session_id: z.string(),
  status: z.string(),
  deadline_at: z.string().nullable().optional(),
  server_now: z.string(),
});
export type ExamClockState = z.infer<typeof examClockSchema>;
export const parseExamClock = (raw: unknown): ExamClockState => examClockSchema.parse(raw);

export const parseUuid = (raw: unknown): string => z.string().min(1).parse(raw);
/** finish_exam_session exam_session_view döner; oynatıcı yalnız başarıyı bilir. */
export const parseAny = (raw: unknown): unknown => raw;

export interface ExamOption {
  key: string;
  /** Telifli sınavda metin yok: şık yalnız harftir. */
  text: string | null;
}

export interface ExamCrop {
  src: string;
  bbox: { x: number; y: number; w: number; h: number };
  /** Sayfa oranı (genişlik / yükseklik). */
  pageAspect: number;
}

/** İstemciye giden soru: yalnız ekranın gerektirdiği alanlar. */
export interface ExamItem {
  no: number;
  questionId: string;
  section: string | null;
  kind: 'mcq' | 'numeric' | 'open';
  stem: string | null;
  options: ExamOption[];
  figure: { src: string; alt: string } | null;
  /** Telifli sınav: soru metni yok, kitapçık sayfasından kırpım gösterilir. */
  crop: ExamCrop | null;
}
