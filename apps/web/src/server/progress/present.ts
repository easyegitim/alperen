// Gelişim ekranının saf hesapları (test/progress.test.ts): bant kelimeleri, son 7 gün serisi (Europe/Istanbul günleri),
// hedefe kalan gün, net biçimi, haftalık çizginin deterministik SVG geometrisi. Yüzde yok; sayılar kelimeyle.

export const TZ = 'Europe/Istanbul';

export type Band = 'low' | 'mid' | 'high' | null;

export const BAND_WORDS: Record<'low' | 'mid' | 'high' | 'none', string> = { low: 'zayıf', mid: 'orta', high: 'iyi', none: 'az veri' };

export function bandWord(band: Band): string {
  return band ? BAND_WORDS[band] : BAND_WORDS.none;
}

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const dayNameFmt = new Intl.DateTimeFormat('tr-TR', { timeZone: TZ, weekday: 'short' });

/** İstanbul takvim günü (YYYY-AA-GG). */
export function dayKey(d: Date): string {
  return dayKeyFmt.format(d);
}

export interface DayPoint {
  key: string;
  /** "Çar", "Per", …; bugün "Bugün". */
  label: string;
  /** Uzun ad (alternatif metin için): "Çarşamba". */
  longLabel: string;
  value: number;
  today: boolean;
}

const LONG: Record<string, string> = { Pzt: 'Pazartesi', Sal: 'Salı', Çar: 'Çarşamba', Per: 'Perşembe', Cum: 'Cuma', Cmt: 'Cumartesi', Paz: 'Pazar' };

/** Son 7 günün (bugün dahil) çözülen soru sayısı. */
export function lastSevenDays(timestamps: string[], now: Date): DayPoint[] {
  const counts = new Map<string, number>();
  for (const t of timestamps) {
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) continue;
    const k = dayKey(d);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const out: DayPoint[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000);
    const key = dayKey(d);
    const short = dayNameFmt.format(d).replace('.', '');
    out.push({ key, label: i === 0 ? 'Bugün' : short, longLabel: i === 0 ? 'bugün' : (LONG[short] ?? short), value: counts.get(key) ?? 0, today: i === 0 });
  }
  return out;
}

/** "Son 7 günde çözülen soru: Çarşamba 4, …, bugün 6." */
export function seriesAlt(points: DayPoint[]): string {
  return `Son 7 günde çözülen soru: ${points.map((p) => `${p.longLabel} ${p.value}`).join(', ')}.`;
}

/** Hedef tarihe kalan gün (İstanbul günleriyle); tarih yoksa ya da geçtiyse null. */
export function daysUntil(examDate: string | null | undefined, now: Date): number | null {
  if (!examDate || !/^\d{4}-\d{2}-\d{2}/.test(examDate)) return null;
  const today = Date.parse(`${dayKey(now)}T00:00:00Z`);
  const target = Date.parse(`${examDate.slice(0, 10)}T00:00:00Z`);
  const days = Math.round((target - today) / 86_400_000);
  return days >= 0 ? days : null;
}

/** "YKS’ye", "ALES’e"; bilinmeyen sınav "hedefe". */
export function examDative(targetExam: string | null | undefined): string {
  const t = (targetExam ?? '').trim().toUpperCase();
  if (!t) return 'hedefe';
  if (t === 'ALES') return 'ALES’e';
  if (['TYT', 'AYT', 'YKS', 'LGS', 'KPSS', 'DGS', 'YDS'].includes(t)) return `${t}’ye`;
  return 'hedefe';
}

/** Türkçe ondalık (27,5); tam sayı ondalıksız. */
export function formatNet(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace('.', ',');
}

/** exam_sessions.score → net (yoksa null). */
export function netOf(score: unknown): number | null {
  if (!score || typeof score !== 'object') return null;
  const n = (score as { net?: unknown }).net;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export interface LineGeometry {
  width: number;
  height: number;
  max: number;
  ticks: Array<{ y: number; label: string }>;
  points: Array<{ x: number; y: number; value: number; label: string; today: boolean }>;
  polyline: string;
}

/** Haftalık çizgi (mockup S08): 302×150, x 30→282, y 120 (sıfır) → 20 (üst). Üst sınır 5'in katına yuvarlanır. */
export function lineGeometry(points: DayPoint[]): LineGeometry {
  const peak = Math.max(0, ...points.map((p) => p.value));
  const max = Math.max(5, Math.ceil(peak / 5) * 5);
  const x0 = 30;
  const step = points.length > 1 ? 252 / (points.length - 1) : 0;
  const y = (v: number) => Math.round((120 - (v / max) * 100) * 10) / 10;
  const pts = points.map((p, i) => ({ x: Math.round((x0 + i * step) * 10) / 10, y: y(p.value), value: p.value, label: p.label, today: p.today }));
  return {
    width: 302,
    height: 150,
    max,
    ticks: [
      { y: 20, label: String(max) },
      { y: 70, label: formatNet(max / 2) },
      { y: 120, label: '0' },
    ],
    points: pts,
    polyline: pts.map((p) => `${p.x},${p.y}`).join(' '),
  };
}

export const DOCUMENT_KIND_LABELS: Record<string, string> = {
  notes: 'Not',
  mock_exam: 'Deneme',
  report: 'Rapor',
  question_set: 'Soru seti',
  answer_key: 'Cevap anahtarı',
};

/** Belgelerim satırı: "Rasyonel sayılar · Not". */
export function documentLine(title: string, kind: string): string {
  const label = DOCUMENT_KIND_LABELS[kind];
  return label && !title.toLocaleLowerCase('tr').includes(label.toLocaleLowerCase('tr')) ? `${title} · ${label}` : title;
}

export interface TopicRow {
  skillId: string;
  name: string;
  band: Band;
  word: string;
}

/** Konular: kanıtı olan yapraklar müfredat koduna göre; kanıtsızlar sona. */
export function topicRows(rows: Array<{ skill_id: string; skill_name: string; band: Band; evidence_count: number }>): TopicRow[] {
  return [...rows]
    .filter((r) => r.evidence_count > 0)
    .sort((a, b) => (a.band === null) === (b.band === null) ? a.skill_id.localeCompare(b.skill_id, 'tr', { numeric: true }) : a.band === null ? 1 : -1)
    .map((r) => ({ skillId: r.skill_id, name: r.skill_name, band: r.band, word: bandWord(r.band) }));
}

/** Taslak bitti mi (Bugün'e geçilir): aktif, hazır, atlandı (aktif müfredata taşındı) ya da düştü. */
export function draftDone(s: { status: string; draft_status: string | null } | null): boolean {
  if (!s) return true;
  return s.status === 'active' || s.draft_status === null || ['ready', 'skipped', 'failed'].includes(s.draft_status);
}
