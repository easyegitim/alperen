// Türkçe biçimlendirme yardımcıları (sunucu ve istemci).

const MONTHS_SHORT = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

/** "19 Eki 14:32" (verilen saat diliminde). Geçersiz tarihte boş metin. */
export function formatDateTimeTr(iso: string | null | undefined, timeZone = 'Europe/Istanbul'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('tr-TR', { timeZone, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const month = MONTHS_SHORT[Number(get('month')) - 1] ?? '';
  return `${get('day')} ${month} ${get('hour')}:${get('minute')}`;
}

/** Görünen adın ilk sözcüğü ("Ayşe Yılmaz" -> "Ayşe"); ad yoksa boş metin. */
export function firstName(displayName: string | null | undefined): string {
  return (displayName ?? '').trim().split(/\s+/)[0] ?? '';
}
