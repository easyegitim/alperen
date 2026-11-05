/**
 * system[2] (5 dk önbellek): çocuğun kısa durum bloğu, `parent_child_summary` verisinden. Veliye açık veridir; ad,
 * olasılık (p), koç sohbeti ve soru metni yoktur (LLM'e ad gitmez: profiles.display_name kuralı). Ayrıntı için model
 * araçları çağırır. Saf modül (testler).
 */
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Kullanıcı verisi (ders/deneme adı) veri bloğunu kapatamasın: `<`/`>` atılır, tek satır. */
const clean = (v: unknown, max = 80) => String(v ?? '').replace(/[<>\r\n]+/g, ' ').trim().slice(0, max);

function trNum(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',');
}

function minutes(m: number): string {
  if (m <= 0) return 'kayıt yok';
  if (m < 60) return `${Math.round(m)} dakika`;
  return `yaklaşık ${trNum(Math.round((m / 60) * 2) / 2)} saat`;
}

const TREND: Record<string, string> = { up: 'yükseliyor', steady: 'yatay', down: 'biraz geriledi' };

export function childContextText(raw: unknown): string | null {
  const s = obj(raw);
  if (!s.week) return null;
  const w = obj(s.week);
  const p = obj(s.prev_week);
  const lines = ['<child_status>', 'Velinin çocuğunun kısa durumu (veliye açık veri; süreler tahminidir; bantlar kanıt sayısına dayanır):'];
  lines.push(`- Bu hafta (${clean(w.start, 10)} pazartesiden beri): ${minutes(num(w.minutes))}, ${num(w.questions)} soru, ${num(w.active_days)} etkin gün`);
  lines.push(`- Geçen hafta: ${minutes(num(p.minutes))}, ${num(p.questions)} soru`);
  const le = s.last_exam ? obj(s.last_exam) : null;
  if (le && le.net !== null && le.net !== undefined) lines.push(`- Son deneme: ${clean(le.title ?? 'Deneme')}, ${trNum(num(le.net))} net (${clean(le.finished_at, 10)})`);
  for (const c of Array.isArray(s.courses) ? s.courses.slice(0, 4) : []) {
    const x = obj(c);
    const b = obj(x.bands);
    const trend = typeof x.trend === 'string' ? `; yön: ${TREND[x.trend] ?? x.trend}` : '';
    lines.push(`- ${clean(x.title ?? 'Ders')}: ${num(b.high)} kazanım yüksek, ${num(b.mid)} orta, ${num(b.low)} düşük, ${num(b.insufficient)} kazanımda veri az${trend}`);
  }
  if (num(s.open_misconceptions) > 0) lines.push(`- Üzerinde çalışılan yanılgı sayısı: ${num(s.open_misconceptions)}`);
  if (s.last_activity_at) lines.push(`- Son etkinlik: ${clean(s.last_activity_at, 10)}`);
  lines.push('</child_status>');
  return lines.join('\n');
}
