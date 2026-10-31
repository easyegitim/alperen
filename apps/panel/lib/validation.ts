// Panelde, mock'ta ve live'da AYNI kurallar (mock/live farkı olmasın diye tek yer).
// Sunucu kısıtlarının yanında istemci denetimidir; hata kodu istemci yereldir (PANEL-FORM, README "Hata kodları").
import { PanelError } from './errors';
import { LEGAL_BASES, type ExamSourceMeta } from './data/types';

export const EXAM_TERMS = ['vize', 'final', 'but', 'deneme', 'osym', 'diger'] as const;
export const ALIAS_RE = /^hoca-[A-Z]$/;
/** Arşiv PDF'i için üst sınır (Storage 1 GB bütçesi, §3.12); daha büyük tarama parçalanarak yüklenir. */
export const EXAM_PDF_MAX_BYTES = 20 * 1024 * 1024;
export const RETENTION_DAYS_MIN = 1;
export const RETENTION_DAYS_MAX = 365;
export const AUTO_ANSWER_MIN_MAX = 240;

/** Dosya PDF mi (MIME ya da uzantı) ve boyutu uygun mu; uygun değilse Türkçe sebep. */
export function examFileProblem(file: Blob & { name?: string }): string | null {
  const name = file.name ?? '';
  const isPdf = file.type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
  if (!isPdf) return 'PDF gerekli';
  if (file.size === 0) return 'dosya boş';
  if (file.size > EXAM_PDF_MAX_BYTES) return 'dosya 20 MB sınırını aşıyor';
  return null;
}

/** Arşiv kaydı alanları; uygun değilse Türkçe sebep. */
export function examMetaProblem(meta: ExamSourceMeta): string | null {
  if (!meta.course_id) return 'kurs seçilmedi';
  if (!ALIAS_RE.test(meta.instructor_alias)) return 'takma ad hoca-A…hoca-Z';
  if (!(LEGAL_BASES as readonly string[]).includes(meta.legal_basis)) return 'hukuki dayanak seçilmedi';
  if (!(EXAM_TERMS as readonly string[]).includes(meta.term)) return 'dönem türü';
  if (!Number.isInteger(meta.year) || meta.year < 1990 || meta.year > 2100) return 'yıl';
  return null;
}

export function assertExamUpload(file: Blob & { name?: string }, meta: ExamSourceMeta): void {
  const problem = examFileProblem(file) ?? examMetaProblem(meta);
  if (problem) throw new PanelError('PANEL-FORM', problem);
}

export interface ChatFields {
  group_auto_answer_min?: number;
  retention_days?: number;
}

/** tg_chats düzenleme alanları; §3.5'te CHECK kısıtı olmadığı için istemci zorlar (0 gün saklama = geçmişin silinmesi). */
export function chatFieldsProblem(fields: ChatFields): string | null {
  if (fields.retention_days !== undefined) {
    const d = fields.retention_days;
    if (!Number.isInteger(d) || d < RETENTION_DAYS_MIN || d > RETENTION_DAYS_MAX) return `Saklama günü ${RETENTION_DAYS_MIN}–${RETENTION_DAYS_MAX} arasında olmalı.`;
  }
  if (fields.group_auto_answer_min !== undefined) {
    const m = fields.group_auto_answer_min;
    if (!Number.isInteger(m) || m < 0 || m > AUTO_ANSWER_MIN_MAX) return `Otomatik cevap süresi 0–${AUTO_ANSWER_MIN_MAX} dakika arasında olmalı.`;
  }
  return null;
}

export function assertChatFields(fields: ChatFields): void {
  const problem = chatFieldsProblem(fields);
  if (problem) throw new PanelError('PANEL-FORM', problem);
}

/** Form metnini tam sayıya çevirir; yalnız rakamsa (boş ya da "1e3" gibi girdiler geçersiz). */
export function parseWholeNumber(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

/** mint_guardian_code / mint_staff_code 8 karakter döner (§3.9); gösterim 'K7F3-2QX9' biçimindedir. redeem '-' işaretini atar. */
export function formatCode(code: string): string {
  const c = code.trim().toUpperCase();
  return c.replace(/^([A-Z2-7]{4})([A-Z2-7]{4})$/, '$1-$2');
}
