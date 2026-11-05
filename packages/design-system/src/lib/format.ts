// Türkçe sayı ve süre biçimleri: %62, 3,5 saat, 12 dk · 8 soru, 0,002 $.

const nf = (digits: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** 0–1 aralığındaki olasılığı "%72" biçimine çevirir. */
export function formatPercent(p: number): string {
  const v = Math.round(Math.max(0, Math.min(1, p)) * 100);
  return `%${v}`;
}

/** Değişimi işaretle yazar: "+%8", "−%3" (gerçek eksi işareti), "%0". */
export function formatDelta(delta: number): string {
  const v = Math.round(delta * 100);
  if (v === 0) return '%0';
  return `${v > 0 ? '+' : '−'}%${Math.abs(v)}`;
}

/** 1284 -> "1.284", 1.4 -> "1,4". */
export function formatNumber(n: number, maxDigits = 1): string {
  return nf(maxDigits).format(n);
}

/** Saniyeyi "mm:ss" ya da bir saati aşarsa "h:mm:ss" yapar. */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Saniyeyi okunur süreye çevirir: "45 sn", "12 dk", "1 sa 5 dk". */
export function formatDurationWords(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  if (s < 60) return `${s} sn`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m} dk`;
  return m === 0 ? `${h} sa` : `${h} sa ${m} dk`;
}
