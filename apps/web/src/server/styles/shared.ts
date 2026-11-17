// Tarz kütüphanesi (P4, mockup S13): eğitmen sayfasının ve öğrenci satırının saf kuralları. İstemci ve sunucu kullanır;
// 'server-only' değildir. RPC yanıt biçimleri supabase/migrations/0037_style_rpcs.sql ve 0038_priority_plan.sql'den.
import { z } from 'zod';

export const EXAM_TERMS = [
  { value: 'osym', label: 'ÖSYM' },
  { value: 'meb', label: 'MEB' },
  { value: 'vize', label: 'Vize' },
  { value: 'final', label: 'Final' },
  { value: 'but', label: 'Bütünleme' },
  { value: 'deneme', label: 'Deneme' },
  { value: 'diger', label: 'Diğer' },
] as const;
export type ExamTerm = (typeof EXAM_TERMS)[number]['value'];

export const ARCHIVE_LIMITS = {
  /** ingest_exam_source: 1–60 tekil dosya. */
  maxFiles: 60,
} as const;

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const num = z.coerce.number();

const coverage = z.object({
  students_total: num,
  students_solved: num,
  solved: num,
  correct: num,
  unsolved: z.array(z.object({ enrollment_id: uuid, display_name: z.string().nullable() }).passthrough()),
});

const style = z
  .object({
    id: uuid,
    code: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    format: z.string().nullable(),
    trick: z.string().nullable(),
    difficulty_band: z.string().nullable(),
    status: z.enum(['draft', 'active', 'retired']),
    source: z.string(),
    reviewed_at: z.string().nullable(),
    skills: z.array(z.object({ id: z.string(), name: z.string().nullable() })),
    years_hit: z.array(num),
    years_total: num.nullable(),
    last_year: num.nullable(),
    frequency: num.nullable(),
    recency: num.nullable(),
    alignment: num.nullable(),
    score: num.nullable(),
    appearances: z.array(z.object({ item_id: uuid, year: num.nullable(), term: z.string().nullable(), item_no: num })),
    coverage,
  })
  .passthrough();
export type LibraryStyle = z.output<typeof style>;

const planRow = z
  .object({
    rank: num,
    topic: z.string(),
    kind: z.string(),
    hits: num,
    years: num,
    points_text: z.string().optional(),
    evidence_count: num.optional(),
    style_ids: z.array(uuid).optional(),
  })
  .passthrough();

const plan = z
  .object({
    id: uuid,
    status: z.enum(['pending_review', 'approved', 'retired']),
    period: z.string().nullable(),
    created_at: z.string(),
    approved_at: z.string().nullable(),
    plan: z
      .object({
        years_total: num.optional(),
        rows: z.array(planRow),
        others: z.array(z.string()).optional(),
        uncovered_topics: z.array(z.string()).optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type LibraryPlan = z.output<typeof plan>;

export const libraryView = z
  .object({
    role: z.literal('staff'),
    can_manage: z.boolean(),
    course: z.object({ id: uuid, code: z.string(), title: z.string() }),
    archive: z
      .object({
        years_from: num.nullable(),
        years_to: num.nullable(),
        years_total: num,
        sources: num,
        items: num,
        styled_items: num,
        pending_sources: num,
        last_clustered_at: z.string().nullable(),
      })
      .passthrough(),
    plan: plan.nullable(),
    styles: z.array(style),
  })
  .passthrough();
export type LibraryView = z.output<typeof libraryView>;

export function parseLibrary(raw: unknown): LibraryView {
  return libraryView.parse(raw);
}

// --- sunumu (saf) ---------------------------------------------------------------------------------------------------

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** "31 Eki" (İstanbul günü). */
export function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const tr = new Date(d.getTime() + 3 * 3600_000);
  return `${tr.getUTCDate()} ${MONTHS[tr.getUTCMonth()]}`;
}

/** Arşiv özeti: "2018–2025 · 8 sınav yılı · 320 çıkmış soru · 24 tarz · Son kümeleme 31 Eki". */
export function archiveLine(v: LibraryView): string {
  const a = v.archive;
  if (a.sources === 0) return 'Henüz çıkmış sınav yüklenmedi.';
  const parts: string[] = [];
  if (a.years_from != null && a.years_to != null) parts.push(a.years_from === a.years_to ? String(a.years_from) : `${a.years_from}–${a.years_to}`);
  parts.push(`${a.years_total} sınav yılı`, `${a.items} çıkmış soru`);
  const active = v.styles.filter((s) => s.status !== 'retired').length;
  parts.push(`${active} tarz`);
  const last = shortDate(a.last_clustered_at);
  if (last) parts.push(`Son kümeleme ${last}`);
  return parts.join(' · ');
}

/** "6/8 yıl" (sıklık çubuğunun metni; yüzde yok). */
export function frequencyText(s: Pick<LibraryStyle, 'years_hit' | 'years_total'>): string {
  const total = s.years_total ?? 0;
  return total > 0 ? `${s.years_hit.length}/${total} yıl` : `${s.years_hit.length} yıl`;
}

/** Güncellik satırı: "son 2025 · 5 yıl üst üste" / "son 2024". */
export function recencyText(s: Pick<LibraryStyle, 'years_hit' | 'last_year'>): string {
  if (s.last_year == null) return 'Henüz çıkmadı';
  const years = [...new Set(s.years_hit.map(Number))].sort((a, b) => b - a);
  let run = 0;
  for (const [i, y] of years.entries()) {
    if (y === s.last_year - i) run += 1;
    else break;
  }
  return run >= 2 ? `son ${s.last_year} · ${run} yıl üst üste` : `son ${s.last_year}`;
}

/**
 * Kapsama: "12 öğrenciden 7 kişi çözdü" (kayıtlı öğrenci yoksa "Henüz kayıtlı öğrenci yok"). Sayıya bağlı ek (-si/-ü/-ı)
 * kullanılmaz: 0, 1, 3 gibi sayılarda ek değişir, bu cümle her sayıda doğru kalır.
 */
export function coverageText(c: LibraryStyle['coverage']): string {
  if (c.students_total === 0) return 'Henüz kayıtlı öğrenci yok';
  return `${c.students_total} öğrenciden ${c.students_solved} kişi çözdü`;
}

/** Çözenlerde doğru: "24 denemede 17 doğru" (hiç çözülmediyse null). */
export function correctText(c: LibraryStyle['coverage']): string | null {
  return c.solved > 0 ? `${c.solved} denemede ${c.correct} doğru` : null;
}

/** Skor 0–1 → "0,91" (mockup "Skor 0,91"). */
export function scoreText(v: number | null): string {
  return v == null ? '—' : v.toFixed(2).replace('.', ',');
}

/** Sıklık / güncellik / müfredat bantları kelimeyle (eğitmen ayrıntısında sayının yanında). */
export function bandWord(v: number | null): string {
  if (v == null) return 'belirsiz';
  return v >= 0.67 ? 'yüksek' : v >= 0.34 ? 'orta' : 'düşük';
}

export const DIFFICULTY_WORD: Record<string, string> = { easy: 'kolay', mid: 'orta', hard: 'zor' };

export type StyleSort = 'priority' | 'frequency' | 'coverage';
export const SORTS: ReadonlyArray<{ value: StyleSort; label: string }> = [
  { value: 'priority', label: 'Öncelik skoru' },
  { value: 'frequency', label: 'Sıklık' },
  { value: 'coverage', label: 'Öğrenci kapsaması' },
];

export type StyleFilter = 'all' | 'unnamed';

/** Adı onay bekleyen: taslak ve yapay zekâ çıkarımı, eğitmen henüz bakmadı. */
export function needsNaming(s: Pick<LibraryStyle, 'status' | 'reviewed_at' | 'source'>): boolean {
  return s.status === 'draft' && !s.reviewed_at;
}

/** Liste: emekli olmayanlar, süzgeç ve sıralama (eşitlikte ad). */
export function arrangeStyles(styles: LibraryStyle[], sort: StyleSort, filter: StyleFilter): LibraryStyle[] {
  const base = styles.filter((s) => s.status !== 'retired' && (filter === 'all' || needsNaming(s)));
  const key = (s: LibraryStyle): number =>
    sort === 'frequency'
      ? (s.frequency ?? -1)
      : sort === 'coverage'
        ? s.coverage.students_total > 0
          ? s.coverage.students_solved / s.coverage.students_total
          : 2
        : (s.score ?? -1);
  // kapsama: az çözülen önce (eğitmenin ilgilenmesi gereken); diğerleri çoktan aza
  return [...base].sort((a, b) => (sort === 'coverage' ? key(a) - key(b) : key(b) - key(a)) || a.name.localeCompare(b.name, 'tr'));
}

export interface PriorityLine {
  rank: number;
  topic: string;
  kind: string;
  hits: number;
  years: number;
  points: string | undefined;
  evidence: string;
  score: number | null;
}

/** Öncelik planı satırları (ExamPriorityRow girdisi). Skor, plana yazılı tarzın skorundan gelir. */
export function priorityLines(plan: LibraryPlan | null, styles: LibraryStyle[]): PriorityLine[] {
  if (!plan) return [];
  const byId = new Map(styles.map((s) => [s.id, s]));
  return plan.plan.rows.map((r) => {
    const st = (r.style_ids ?? []).map((id) => byId.get(id)).find(Boolean);
    const last = st?.last_year ?? null;
    const n = r.evidence_count ?? r.hits;
    return {
      rank: r.rank,
      topic: r.topic,
      kind: r.kind,
      hits: r.hits,
      years: r.years,
      // maddelerde puan yoksa (ÖSYM/MEB soruları çoğunlukla puansızdır) "≈0 puan" gösterilmez
      points: r.points_text && r.points_text !== '≈0 puan' ? r.points_text : undefined,
      evidence: `Kanıt: ${n} soru${last ? ` · son ${last}` : ''}`,
      score: st?.score ?? null,
    };
  });
}

export const PLAN_STATUS_WORD: Record<LibraryPlan['status'], string> = {
  pending_review: 'Onayını bekliyor',
  approved: 'Onaylandı',
  retired: 'Kaldırıldı',
};

// --- eylem girdileri -----------------------------------------------------------------------------------------------

export interface ExamFileMeta {
  id: string;
  path: string;
  mime: 'image/jpeg' | 'application/pdf';
  bytes: number;
  sha256: string | null;
  width: number | null;
  height: number | null;
}

export interface IngestInput {
  courseId: string;
  year: number;
  term: ExamTerm;
  files: ExamFileMeta[];
}

const fileMeta = z.object({
  id: uuid,
  path: z.string().min(3).max(200),
  mime: z.enum(['image/jpeg', 'application/pdf']),
  bytes: z.number().int().positive().max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i).nullable(),
  width: z.number().int().min(0).max(20_000).nullable(),
  height: z.number().int().min(0).max(20_000).nullable(),
});

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Sunucu eylemi girdisi: yıl 1950–gelecek yıl, tür listede, 1–60 tekil dosya, yol çağıranın klasöründe. */
export function parseIngest(raw: unknown, ownerId: string, nowYear: number = new Date().getFullYear()): Parsed<IngestInput> {
  const bad = (error: string): Parsed<IngestInput> => ({ ok: false, error });
  if (!raw || typeof raw !== 'object') return bad('Gönderim okunamadı.');
  const r = raw as Record<string, unknown>;
  if (typeof r.courseId !== 'string' || !uuid.safeParse(r.courseId).success) return bad('Ders seçilemedi.');
  const year = Number(r.year);
  if (!Number.isInteger(year) || year < 1950 || year > nowYear + 1) return bad('Sınavın yılını dört haneli yaz.');
  if (!EXAM_TERMS.some((t) => t.value === r.term)) return bad('Sınav türünü seç.');
  if (!Array.isArray(r.files) || r.files.length === 0) return bad('En az bir dosya ekle.');
  if (r.files.length > ARCHIVE_LIMITS.maxFiles) return bad(`En çok ${ARCHIVE_LIMITS.maxFiles} dosya gönderebilirsin.`);
  const files: ExamFileMeta[] = [];
  const seen = new Set<string>();
  for (const f of r.files) {
    const p = fileMeta.safeParse(f);
    if (!p.success || seen.has(p.data.id)) return bad('Dosya bilgisi geçersiz.');
    const ext = p.data.mime === 'application/pdf' ? 'pdf' : 'jpg';
    if (p.data.path !== `${ownerId}/${p.data.id}.${ext}`) return bad('Dosya yolu geçersiz.');
    seen.add(p.data.id);
    files.push(p.data);
  }
  return { ok: true, value: { courseId: r.courseId, year, term: r.term as ExamTerm, files } };
}

/** Yeni tarz kodu (ders içinde tekil): 'E-' + zaman + rastgele; sunucu eyleminde üretilir. */
export function newStyleCode(now: number = Date.now(), rand: number = Math.random()): string {
  return `E-${now.toString(36).toUpperCase()}${Math.floor(rand * 36 ** 3).toString(36).toUpperCase().padStart(3, '0')}`;
}

/** RPC hata kodu → eğitmene tek cümle. */
export const STYLE_ERRORS: Record<string, string> = {
  'OGR-AUTH-001': 'Bu dersin tarz kütüphanesini görme yetkin yok.',
  'OGR-AUTH-002': 'Bu işlem için dersin eğitmeni olman gerekir.',
  'OGR-STYLE-001': 'Ders bulunamadı.',
  'OGR-STYLE-002': 'Yıl ve sınav türünü kontrol et.',
  'OGR-STYLE-007': 'Tarz bilgisi geçersiz: ad 3–80, tanım en çok 500 karakter olmalı.',
  'OGR-STYLE-008': 'Birleştirmek için aynı dersten iki ayrı tarz seç.',
  'OGR-STYLE-010': 'Öncelik listesi için en az iki yılın çıkmış sınavı gerekir.',
  'OGR-STYLE-011': 'Önce yüklenen sınavların tarzlara ayrılması bitmeli.',
  'OGR-STYLE-012': 'Plan artık bekleyen durumda değil.',
  'OGR-STYLE-013': 'Bu tarza şu an soru üretilemiyor.',
  'OGR-UPL-001': 'Bir gönderimde 1–60 dosya olabilir.',
  'OGR-UPL-002': 'Dosyalar bulunamadı. Yeniden seçip gönder.',
  'OGR-UPL-003': 'Dosyaların bir kısmı başka bir gönderimde. Yeniden gönderirsen yeni gönderim olarak alırım.',
};

export const GENERIC_ERROR = 'Kaydedilemedi. Biraz sonra yeniden dene.';

// --- öğrenci satırı -------------------------------------------------------------------------------------------------

/** Gelişim › Konular altındaki tek satır: "Tarz: 2/5 çözdün". Tarz yoksa null (satır hiç çizilmez). */
export function studentStyleLine(summary: { styles: number; never_solved: number } | null): string | null {
  if (!summary || summary.styles <= 0) return null;
  const solved = Math.max(0, summary.styles - summary.never_solved);
  return `Tarz: ${solved}/${summary.styles} çözdün`;
}

/** Katlı ayrıntı: tarz adı + RPC'nin kapsama cümlesi ("Bu tarzı hiç çözmedin" | "3 çözdün, 1 doğru"). */
export interface StudentStyleRow {
  styleId: string;
  name: string;
  text: string;
}
