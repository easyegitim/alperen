// Bugün ekranının düzeni (saf; test/suggestions.test.ts). Kaynak: list_today_suggestions (0020_suggestions.sql; rank
// sıralı, en çok 4 satır). Kural (PLAN-v2 §13): tek kahraman kart (ilk başlatılabilir öneri, tek birincil "Başla"),
// altında en çok 3 kutu, belge/yükleme sonucu kartları ayrı satır.
import { z } from 'zod';
import { examHref } from '@/server/exam-result/present';
import { documentHref } from '@/server/documents/present';

export const SUGGESTION_KINDS = ['practice', 'weekly_homework', 'lesson_review', 'gap_analysis', 'mini_exam', 'document_ready', 'upload_result'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/** Kutu ve kart etiketleri (tasarım sistemi SUGGESTION_KIND_LABELS ile aynı; sunucu bileşeninde de okunur). */
export const KIND_LABELS: Record<SuggestionKind, string> = {
  practice: 'Alıştırma',
  weekly_homework: 'Haftalık ödev',
  lesson_review: 'Ders tekrarı',
  gap_analysis: 'Eksik analizi',
  mini_exam: 'Mini deneme',
  document_ready: 'Belge hazır',
  upload_result: 'Yükleme sonucu',
};

/** start_practice'in kabul ettiği türler (0021_practice.sql). */
export const PRACTICE_KINDS: readonly SuggestionKind[] = ['practice', 'weekly_homework', 'lesson_review', 'gap_analysis'];
/** Bildirim kartı olarak çizilenler (Başla değil Aç). */
export const NOTICE_KINDS: readonly SuggestionKind[] = ['document_ready', 'upload_result'];

const row = z.object({
  id: z.string(),
  enrollment_id: z.string().nullable().optional(),
  kind: z.string(),
  title: z.string(),
  subtitle: z.string().nullable().optional(),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
  rank: z.number(),
  expires_at: z.string().nullable().optional(),
  created_at: z.string(),
});

export interface Suggestion {
  id: string;
  enrollmentId: string | null;
  kind: SuggestionKind;
  title: string;
  subtitle: string | null;
  payload: Record<string, unknown>;
  rank: number;
  expiresAt: string | null;
  createdAt: string;
}

/** RPC satırları → Suggestion (bilinmeyen tür atlanır; arayüz yeni türü bilene dek çizilmez). */
export function parseSuggestions(raw: unknown): Suggestion[] {
  const rows = z.array(row).parse(raw ?? []);
  return rows.flatMap((r) =>
    (SUGGESTION_KINDS as readonly string[]).includes(r.kind)
      ? [
          {
            id: r.id,
            enrollmentId: r.enrollment_id ?? null,
            kind: r.kind as SuggestionKind,
            title: r.title.trim(),
            subtitle: r.subtitle?.trim() || null,
            payload: r.payload ?? {},
            rank: r.rank,
            expiresAt: r.expires_at ?? null,
            createdAt: r.created_at,
          },
        ]
      : [],
  );
}

export function compareSuggestions(a: Suggestion, b: Suggestion): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export interface TodayLayout {
  hero: Suggestion | null;
  boxes: Suggestion[];
  notices: Suggestion[];
}

export const MAX_BOXES = 3;

/** Süresi dolanı atar, rank → oluşturulma → kimlik sırasıyla dizer; ilk başlatılabilir öneri kahraman karttır. */
export function arrangeToday(items: Suggestion[], now: Date = new Date()): TodayLayout {
  const live = items.filter((s) => !s.expiresAt || new Date(s.expiresAt).getTime() > now.getTime()).sort(compareSuggestions);
  const seen = new Set<string>();
  const unique = live.filter((s) => (seen.has(s.id) ? false : (seen.add(s.id), true)));
  // Başlatılabilir: alıştırma türleri ve exam_id'li mini_exam (uygulama içi sınav oynatıcısı); exam_id'siz mini_exam kart olmaz.
  const startable = unique.filter((s) => PRACTICE_KINDS.includes(s.kind) || examIdOf(s) !== null);
  const notices = unique.filter((s) => NOTICE_KINDS.includes(s.kind));
  return { hero: startable[0] ?? null, boxes: startable.slice(1, 1 + MAX_BOXES), notices };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/** "8 soru · 12 dk": alt satır yoksa payload'dan (count, minutes) kurulur. */
export function metaLine(s: Suggestion): string | null {
  if (s.subtitle) return s.subtitle;
  const parts: string[] = [];
  const count = num(s.payload.count);
  const minutes = num(s.payload.minutes);
  if (count) parts.push(`${count} soru`);
  if (minutes) parts.push(`${minutes} dk`);
  return parts.length ? parts.join(' · ') : null;
}

/** Kutu altındaki süre ("20 dk"); yoksa soru sayısı. */
export function boxLine(s: Suggestion): string | null {
  const minutes = num(s.payload.minutes);
  if (minutes) return `${minutes} dk`;
  const count = num(s.payload.count);
  return count ? `${count} soru` : s.subtitle;
}

/** mini_exam önerisinin sınavı (payload.exam_id, UUID); başka türde ya da kimlik yoksa null. */
export function examIdOf(s: Suggestion): string | null {
  if (s.kind !== 'mini_exam') return null;
  const v = s.payload.exam_id;
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/** Bildirim kartının açtığı yol (belge görüntüleyici ya da yükleme sonucu); hedef yoksa null. */
export function noticeHref(s: Suggestion): string | null {
  if (s.kind === 'document_ready') {
    const id = str(s.payload.document_id);
    return id ? documentHref(id) : '/ogrenci/gelisim/belgeler';
  }
  if (s.kind === 'upload_result') {
    // Okul denemesi kartı oturum taşır; sonuç ekranı deneme adresindedir.
    const session = str(s.payload.session_id);
    if (session) return examHref(session);
    const analysis = str(s.payload.analysis_id);
    if (analysis) return `/ogrenci/sonuc?analiz=${analysis}`;
    const upload = str(s.payload.upload_id);
    if (upload) return `/ogrenci/sonuc?yukleme=${upload}`;
    return null;
  }
  return null;
}

/** Bildirim kartının alt satırı. */
export function noticeLine(s: Suggestion): string {
  if (s.subtitle) return s.subtitle;
  return s.kind === 'document_ready' ? 'PDF' : 'Sonuç hazır';
}

export function isPracticeKind(kind: SuggestionKind): boolean {
  return PRACTICE_KINDS.includes(kind);
}
