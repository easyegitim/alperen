// Veli ekranları (P6-C): sunucu (src/server/parent) ile istemci (src/components/parent) arasında paylaşılan saf parçalar.
// Veli ekranı sade kalır (PLAN-v2 §13): tek cümle, üç sayı, son rapor, iki düğme. Yüzde yoktur; bantlar kelimedir,
// sayılar Türkçe biçimlidir (4,5 saat, 27,5 net), ton saygılıdır ve alarm vermez.

export type ReportKind = 'weekly' | 'exam' | 'topic' | 'trend';

/** "Rapor iste" tür seçimi: tek satır, dört çip. `custom` yalnız sohbet ajanındadır. */
export const REPORT_KINDS: readonly { kind: ReportKind; label: string }[] = [
  { kind: 'weekly', label: 'Haftalık' },
  { kind: 'exam', label: 'Deneme' },
  { kind: 'topic', label: 'Konu' },
  { kind: 'trend', label: 'Trend' },
];

/** Sohbette bir balon (sunucu `toParentDisplay` ile aynı biçim). */
export interface ParentItem {
  id: string;
  from: 'parent' | 'assistant';
  text: string;
  /** Bu yanıtta açılan rapor istekleri (ince durum satırı). */
  reports?: { documentId: string; title: string; kind: string }[];
}

export const PARENT_COPY = {
  noChild: 'Henüz bağlı bir çocuk yok',
  noChildBody: 'Çocuğunuzla bağlantı kurmak için öğrencinin gönderdiği davet kodunu Ayarlar sayfasından girebilirsiniz.',
  noData: 'Henüz veri yok.',
  chatWelcome: 'Merhaba. Çocuğunuzun bu hafta ne çalıştığını, derslerdeki durumunu ya da son denemesini bana sorabilirsiniz. Rapor isterseniz yazmanız yeterli.',
  chatPlaceholder: 'Öğrenmen’e sorun',
  chatUnavailable: 'Sohbet şu an kullanılamıyor. Biraz sonra yeniden deneyin.',
  chatError: 'Mesaj gönderilemedi. Bağlantınızı kontrol edip yeniden deneyin.',
  chatBusy: 'Önceki sorunuza yanıt hazırlanıyor. Biraz bekleyin.',
  chatSession: 'Oturumunuz kapanmış. Yeniden giriş yapın.',
  reportAsked: 'Raporu hazırlıyorum; hazır olunca haber vereceğim.',
  reportLimit: 'Bugün için rapor sınırına ulaşıldı. Yarın yeniden isteyebilirsiniz.',
  reportNoExam: 'Henüz bitmiş bir deneme yok.',
  reportNeedTopic: 'Hangi konu olsun? Birkaç sözcükle yazın.',
  reportFailed: 'Rapor istenemedi. Biraz sonra yeniden deneyin.',
} as const;

/** 4.5 -> "4,5"; tam sayı ondalıksız. */
export function formatTr(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : String(r).replace('.', ',');
}

export type Trend = 'up' | 'steady' | 'down' | null;

export interface ParentCourse {
  courseId: string | null;
  title: string;
  bands: { low: number; mid: number; high: number; insufficient: number };
  trend: Trend;
}

export interface ParentSummary {
  name: string;
  hours: number;
  minutes: number;
  questions: number;
  prevMinutes: number;
  activeDays: number;
  lastExam: { sessionId: string; title: string; net: number | null } | null;
  courses: ParentCourse[];
  latestReport: { id: string; title: string; createdAt: string } | null;
  lastActivityAt: string | null;
}

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const nz = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const sOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** `parent_child_summary` yanıtı -> ekran verisi. Beklenmeyen biçimde fırlatır (çağıran "veri yok" der). */
export function parseSummary(raw: unknown): ParentSummary {
  const r = obj(raw);
  const student = obj(r.student);
  if (typeof student.name !== 'string' && student.name !== null) throw new Error('student.name yok');
  const week = obj(r.week);
  const prev = obj(r.prev_week);
  const last = r.last_exam ? obj(r.last_exam) : null;
  const rep = r.latest_report ? obj(r.latest_report) : null;
  const courses = (Array.isArray(r.courses) ? r.courses : []).map((c) => {
    const o = obj(c);
    const b = obj(o.bands);
    const trend = o.trend === 'up' || o.trend === 'steady' || o.trend === 'down' ? o.trend : null;
    return {
      courseId: sOrNull(o.course_id),
      title: typeof o.title === 'string' ? o.title : 'Ders',
      bands: { low: nz(b.low), mid: nz(b.mid), high: nz(b.high), insufficient: nz(b.insufficient) },
      trend,
    } satisfies ParentCourse;
  });
  const sessionId = last ? sOrNull(last.session_id) : null;
  const reportId = rep && rep.ready === true ? sOrNull(rep.id) : null;
  return {
    name: typeof student.name === 'string' ? student.name : '',
    hours: nz(week.hours),
    minutes: nz(week.minutes),
    questions: nz(week.questions),
    prevMinutes: nz(prev.minutes),
    activeDays: nz(week.active_days),
    lastExam: last && sessionId ? { sessionId, title: typeof last.title === 'string' ? last.title : 'Deneme', net: typeof last.net === 'number' ? last.net : null } : null,
    courses,
    latestReport: rep && reportId ? { id: reportId, title: typeof rep.title === 'string' ? rep.title : 'Rapor', createdAt: String(rep.created_at ?? '') } : null,
    lastActivityAt: sOrNull(r.last_activity_at),
  };
}

/** Bir dersin baskın bandı: kanıtı olan yaprakların çoğunluğu. Kanıt yoksa null. */
function courseWord(c: ParentCourse): 'zayıf' | 'orta' | 'iyi' | null {
  const { low, mid, high } = c.bands;
  if (low + mid + high === 0) return null;
  if (high >= mid && high >= low) return 'iyi';
  if (low > mid) return 'zayıf';
  return 'orta';
}

/** Ders başlığındaki "TYT Matematik" -> "matematik" (cümle içinde küçük harf; sınav öneki düşer). Dil adları (Türkçe) büyük kalır. */
function courseNoun(title: string): { noun: string; proper: boolean } {
  const t = title.replace(/^(TYT|AYT|LGS|KPSS|YDS|DGS|ALES)\s+/i, '').trim();
  const proper = /(ce|ca|çe|ça)$/i.test(t);
  return { noun: proper ? t : t.toLocaleLowerCase('tr'), proper };
}

/** Türkçe ünlü uyumu için son ünlüye göre -de/-da: "matematikte", "Türkçe’de", "kimyada". */
function locative({ noun, proper }: { noun: string; proper: boolean }): string {
  const vowels = noun.match(/[aeıioöuü]/gi) ?? [];
  const last = (vowels[vowels.length - 1] ?? 'e').toLocaleLowerCase('tr');
  const back = 'aıou'.includes(last);
  const hard = /[fstkçşhp]$/i.test(noun);
  return `${noun}${proper ? '’' : ''}${hard ? 't' : 'd'}${back ? 'a' : 'e'}`;
}

/**
 * Özetin tek cümlesi (sunucuda, şablon; model çağrısı yok). Saygılı ve düz: önce çalışma, sonra ders durumu.
 * Veri yoksa "Henüz veri yok." Örnek: "Elif bu hafta 4,5 saat çalıştı; matematikte ilerliyor, Türkçede tekrar gerekiyor."
 */
export function summarySentence(s: ParentSummary): string {
  const name = s.name || 'Çocuğunuz';
  const studied = s.minutes > 0 || s.questions > 0;
  const withData = s.courses.map((c) => ({ c, word: courseWord(c) })).filter((x) => x.word !== null);
  if (!studied && withData.length === 0 && !s.lastExam) return PARENT_COPY.noData;
  const head = studied
    ? s.minutes >= 60
      ? `${name} bu hafta ${formatTr(s.hours || s.minutes / 60)} saat çalıştı`
      : s.questions > 0
        ? `${name} bu hafta ${s.questions} soru çözdü`
        : `${name} bu hafta kısa süre çalıştı`
    : 'Bu hafta henüz çalışma kaydı yok';
  const parts: string[] = [];
  for (const { c, word } of withData.slice(0, 2)) {
    const noun = courseNoun(c.title);
    if (c.trend === 'up') parts.push(`${locative(noun)} ilerliyor`);
    else if (c.trend === 'down' || word === 'zayıf') parts.push(`${locative(noun)} tekrar gerekiyor`);
    else parts.push(`${locative(noun)} durumu ${word}`);
  }
  return parts.length > 0 ? `${head}; ${parts.join(', ')}.` : `${head}.`;
}

export function isReportKind(v: unknown): v is ReportKind {
  return v === 'weekly' || v === 'exam' || v === 'topic' || v === 'trend';
}

/** Bildirim türlerinin veliye gösterilen kural anahtarları (yalnız velinin aldıkları; sırası ekran sırası). */
export const PARENT_RULES: readonly { kind: string; label: string; hint: string }[] = [
  { kind: 'exam_analysed', label: 'Deneme sonucu', hint: 'Bir deneme incelendiğinde.' },
  { kind: 'weekly_summary', label: 'Haftalık özet', hint: 'Pazar akşamı, haftanın kısa özeti.' },
  { kind: 'report_ready', label: 'İstediğiniz rapor', hint: 'Rapor hazır olduğunda.' },
  { kind: 'improvement', label: 'Belirgin ilerleme', hint: 'Bir konuda ya da denemede ilerleme olduğunda.' },
  { kind: 'misconception_resolved', label: 'Aşılan zorluk', hint: 'Sık yapılan bir hata artık görülmediğinde.' },
  { kind: 'instructor_note_shared', label: 'Eğitmen notu', hint: 'Eğitmen sonraki adımı paylaştığında.' },
  { kind: 'inactivity', label: 'Ara verildiğinde', hint: 'Birkaç gün çalışma olmadığında hatırlatma.' },
];

export interface NotificationCard {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  createdAt: string;
  read: boolean;
  /** Tıklanınca gidilecek uygulama içi yol (yalnız `/veli…`). */
  href: string | null;
}

export function parseNotifications(raw: unknown): { unread: number; items: NotificationCard[] } {
  const r = obj(raw);
  const items = (Array.isArray(r.items) ? r.items : []).map((i) => {
    const o = obj(i);
    const url = sOrNull(obj(o.payload).url);
    return {
      id: String(o.id),
      kind: String(o.kind ?? ''),
      title: String(o.title ?? ''),
      body: sOrNull(o.body),
      createdAt: String(o.created_at ?? ''),
      read: o.read_at !== null && o.read_at !== undefined,
      href: url && /^\/veli(\/|$)/.test(url) && !url.includes('//') ? url : null,
    } satisfies NotificationCard;
  });
  return { unread: nz(r.unread), items };
}

export interface RuleRow {
  kind: string;
  enabled: boolean;
  /** Kural e-posta kanalını taşıyor mu (params.channels). */
  email?: boolean;
}

export function parseRules(raw: unknown): RuleRow[] {
  return (Array.isArray(raw) ? raw : []).map((x) => {
    const o = obj(x);
    const channels = obj(o.params).channels;
    return { kind: String(o.kind ?? ''), enabled: o.enabled !== false, email: Array.isArray(channels) && channels.includes('email') };
  });
}

/** "E-postayla da gönder" açık mı: veli kurallarının hepsi e-posta kanalını taşıyorsa. */
export function emailOn(rules: readonly RuleRow[]): boolean {
  const mine = rules.filter((r) => PARENT_RULES.some((p) => p.kind === r.kind));
  return mine.length > 0 && mine.every((r) => r.email === true);
}

/** E-posta anahtarının yazdığı kanal listesi (in_app her zaman; push abonelik varsa kullanılır). */
export function emailChannels(on: boolean): string[] {
  return on ? ['in_app', 'push', 'email'] : ['in_app', 'push'];
}
