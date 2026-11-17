// Eğitmen "Kuyruk" sayfası: instructor_queue (0050) yanıtının ayrıştırılması, tür adları ve gruplama. Saf modül
// (sunucu ve testler).

export const QUEUE_KINDS = ['coach_note', 'spend_cap', 'review_document', 'lesson_claims', 'curriculum_proposal'] as const;
export type QueueKind = (typeof QUEUE_KINDS)[number];

/** Tür → Türkçe ad (grup başlığı ve sayaç). */
export const QUEUE_KIND_LABELS: Record<QueueKind, string> = {
  coach_note: 'Koç notları',
  spend_cap: 'Harcama tavanında duran üretim',
  review_document: 'İnceleme bekleyen belgeler',
  lesson_claims: 'Düşük güvenli ders iddiaları',
  curriculum_proposal: 'Müfredat önerileri',
};

export interface QueueItem {
  kind: QueueKind;
  id: string;
  createdAt: string;
  title: string;
  detail: string | null;
  studentName: string | null;
  href: string | null;
}

export interface QueueGroup {
  kind: QueueKind;
  label: string;
  items: QueueItem[];
}

const isKind = (v: unknown): v is QueueKind => typeof v === 'string' && (QUEUE_KINDS as readonly string[]).includes(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** Ham diziden öğeler; bilinmeyen tür, kimliksiz satır atlanır; en yeni önce sıralanır. */
export function parseQueue(raw: unknown): QueueItem[] {
  if (!Array.isArray(raw)) return [];
  const out: QueueItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const id = str(o.id);
    if (!isKind(o.kind) || !id) continue;
    // yalnız uygulama içi yollar (açık yönlendirme olmasın)
    const href = str(o.href);
    out.push({
      kind: o.kind,
      id,
      createdAt: str(o.created_at) ?? '',
      title: str(o.title) ?? QUEUE_KIND_LABELS[o.kind],
      detail: str(o.detail),
      studentName: str(o.student_name),
      href: href && href.startsWith('/') && !href.startsWith('//') ? href : null,
    });
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Tür başına sayı (her tür, sıfır dahil). */
export function countByKind(items: readonly QueueItem[]): Record<QueueKind, number> {
  const c = Object.fromEntries(QUEUE_KINDS.map((k) => [k, 0])) as Record<QueueKind, number>;
  for (const i of items) c[i.kind] += 1;
  return c;
}

/** Sabit tür sırasıyla gruplar; boş grup dönmez, grup içi sıra korunur (en yeni önce). */
export function groupQueue(items: readonly QueueItem[]): QueueGroup[] {
  return QUEUE_KINDS.map((kind) => ({ kind, label: QUEUE_KIND_LABELS[kind], items: items.filter((i) => i.kind === kind) })).filter(
    (g) => g.items.length > 0,
  );
}

/** Sunucu eyleminin ?durum= sonucu → kullanıcı mesajı. */
export const QUEUE_MESSAGES: Record<string, string> = {
  okundu: 'Not okundu olarak işaretlendi.',
  onaylandi: 'Onaylandı; üretim bir kez yeniden başlatıldı.',
  zaten: 'Bu istek zaten onaylanmış.',
  yetki: 'Bu öğe senin kapsamında değil.',
  yok: 'Öğe artık kuyrukta değil.',
  hata: 'İşlem şu an yapılamadı. Biraz sonra yeniden dene.',
};
