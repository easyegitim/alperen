/** Türkçe biçimleme yardımcıları (ICU'ya bağlı olmayan, deterministik). */

const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'] as const;

/** 18.5 -> "18,5"; binlik ayracı yok (basılı belgede kısa sayılar). */
export function trNumber(n: number, digits = 1): string {
  const s = Number.isInteger(n) ? String(n) : n.toFixed(digits).replace(/\.?0+$/, '');
  return s.replace('.', ',');
}

/** "2026-11-03" -> "3 Kasım 2026". Geçersizse girdiyi olduğu gibi döndürür. */
export function trDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : iso;
}

/** Süre: 95 sn -> "1 dk 35 sn"; 40 sn -> "40 sn"; 120 sn -> "2 dk". */
export function trDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} sn`;
  return r === 0 ? `${m} dk` : `${m} dk ${r} sn`;
}

export type Band = 'düşük' | 'orta' | 'yüksek';

/** 0..1 oranı kelime bandına çevirir (yüzde gösterilmez). Eşikler: 0,4 ve 0,7. */
export function wordBand(ratio: number): Band {
  if (!Number.isFinite(ratio) || ratio < 0.4) return 'düşük';
  return ratio < 0.7 ? 'orta' : 'yüksek';
}
