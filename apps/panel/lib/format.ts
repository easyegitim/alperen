// Türkçe sayı, süre ve zaman biçimleri (packages/design-system/egitmen-paneli.md "Sayılar ve zaman").
// Saat dilimi Europe/Istanbul: 2016'dan beri sabit UTC+3 (yaz saati yok); Intl saat dilimi verisine bağımlı olmamak için elle uygulanır.

const TR_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const ISTANBUL_OFFSET_MS = 3 * 60 * 60 * 1000;

function toDate(value: string | number | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function istanbulParts(value: string | number | Date) {
  const d = new Date(toDate(value).getTime() + ISTANBUL_OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Ondalık ayırıcı virgül; sondaki sıfırlar atılır. */
export function decimal(value: number, maxDigits = 1): string {
  const fixed = value.toFixed(maxDigits);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return trimmed.replace('.', ',').replace(/^-0$/, '0');
}

/** 0.72 → "%72" (Türkçe: yüzde işareti önde). */
export function percent(p: number): string {
  return '%' + Math.round(p * 100);
}

/** 1.4 → "1,4 saat" */
export function hours(h: number): string {
  return `${decimal(h, 1)} saat`;
}

/** Dolar tutarı: 0.002 → "0,002 $", 0.41 → "0,41 $", 12.5 → "12,50 $". */
export function usd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return '0 $';
  const abs = Math.abs(value);
  if (abs >= 0.01) return `${value.toFixed(2).replace('.', ',')} $`;
  return `${decimal(value, 4)} $`;
}

/** Mutlak zaman: "19 Eki 14:32" (İstanbul saati). */
export function dateTime(value: string | number | Date): string {
  const p = istanbulParts(value);
  return `${p.day} ${TR_MONTHS[p.month]} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** Yalnız gün: "19 Eki" */
export function dayMonth(value: string | number | Date): string {
  const p = istanbulParts(value);
  return `${p.day} ${TR_MONTHS[p.month]}`;
}

/** Tarih (yıl dahil): "19 Eki 2026" */
export function fullDate(value: string | number | Date): string {
  const p = istanbulParts(value);
  return `${p.day} ${TR_MONTHS[p.month]} ${p.year}`;
}

/** Göreli süre öneki: "14 saattir", "3 gündür", "25 dakikadır". Ek, birim sözcüğüne bağlıdır; sayıdan bağımsızdır. */
export function sinceText(from: string | number | Date, now: string | number | Date): string {
  const ms = Math.max(0, toDate(now).getTime() - toDate(from).getTime());
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${Math.max(1, minutes)} dakikadır`;
  const h = Math.floor(minutes / 60);
  if (h < 48) return `${h} saattir`;
  const days = Math.floor(h / 24);
  return `${days} gündür`;
}

/** Alarm türüne göre süre metni: "14 saattir cevapsız", "3 gündür sessiz". */
export function alertSince(kind: string, since: string | null | undefined, now: string | number | Date): string {
  if (!since) return '';
  switch (kind) {
    case 'unanswered':
      return `${sinceText(since, now)} cevapsız`;
    case 'silent':
      return `${sinceText(since, now)} sessiz`;
    case 'deadline':
      return dateTime(since);
    default:
      return `${sinceText(since, now)} açık`;
  }
}

/** Saniye → "00:06" (bir saatin altında) ya da "1:02:03". */
export function clock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

/** Ustalık bandı (mastery_view ile aynı eşikler). */
export function band(p: number): 'düşük' | 'orta' | 'yüksek' {
  return p < 0.4 ? 'düşük' : p < 0.7 ? 'orta' : 'yüksek';
}

/** Güven bandı (ders analizi claim'leri için; yüzde yazılmaz). */
export function confidenceBand(c: number): 'düşük' | 'orta' | 'yüksek' {
  return c < 0.5 ? 'düşük' : c < 0.75 ? 'orta' : 'yüksek';
}

/** Ad + son sözcüğün ilk harfi: "Elif Kaya" → "Elif K." (person_labels() SQL kuralıyla birebir; tek sözcükte "Elif E."). */
export function initialLabel(fullName: string | null | undefined, fallback: string): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fallback;
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last.charAt(0)}.`;
}

/** Konuşma metni: morale değeri → Türkçe. */
export function moraleText(m: string | null | undefined): string {
  switch (m) {
    case 'low':
      return 'düşük';
    case 'medium':
      return 'orta';
    case 'high':
      return 'yüksek';
    default:
      return 'belirsiz';
  }
}
