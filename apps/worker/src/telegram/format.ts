/**
 * Metin biçimi (telegram.md): iç işaretleme yalnız **kalın** ve `kod`; Telegram'a MarkdownV2 olarak
 * gider. Mesaj ≤ 4 satır; uzun metin bölünür. Sayılar Türkçe biçimde (%62, 3,5 saat, 0,002 $).
 */

const SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;
const CODE_SPECIAL = /[`\\]/g;
const TOKEN = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;

export function escapeMarkdownV2(text: string): string {
  return text.replace(SPECIAL, (c) => `\\${c}`);
}

/** İç işaretlemeyi (**kalın**, `kod`) MarkdownV2'ye çevirir; geri kalan her şey kaçışlanır. */
export function toMarkdownV2(text: string): string {
  let out = '';
  let last = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(text); m !== null; m = TOKEN.exec(text)) {
    out += escapeMarkdownV2(text.slice(last, m.index));
    if (m[1] !== undefined) out += '`' + m[1].replace(CODE_SPECIAL, (c) => `\\${c}`) + '`';
    else if (m[2] !== undefined) out += '*' + escapeMarkdownV2(m[2]) + '*';
    last = m.index + m[0].length;
  }
  return out + escapeMarkdownV2(text.slice(last));
}

/** İşaretlemeyi atar (altyazı/sade metin karşılaştırması için). */
export function plainText(text: string): string {
  return text.replace(TOKEN, (_all, code: string | undefined, bold: string | undefined) => code ?? bold ?? '');
}

/** Boş olmayan satırları sayar. */
export function lineCount(text: string): number {
  return text.split('\n').filter((l) => l.trim() !== '').length;
}

/** Metni en çok `max` dolu satırlık parçalara böler (boş satırlar parça içinde korunur). */
export function splitLines(text: string, max = 4): string[] {
  const lines = text.split('\n');
  const chunks: string[] = [];
  let cur: string[] = [];
  let count = 0;
  for (const line of lines) {
    const filled = line.trim() !== '';
    if (filled && count === max) {
      chunks.push(cur.join('\n').trim());
      cur = [];
      count = 0;
    }
    cur.push(line);
    if (filled) count++;
  }
  const rest = cur.join('\n').trim();
  if (rest !== '') chunks.push(rest);
  return chunks;
}

/** Türkçe yüzde: 0.62 → "%62". */
export function formatPercent(ratio: number): string {
  return `%${Math.round(ratio * 100)}`;
}

/** Türkçe ondalık: 3.5 → "3,5" (en çok `digits` basamak, sondaki sıfırlar atılır). */
export function formatDecimal(value: number, digits = 1): string {
  const fixed = value.toFixed(digits);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return trimmed.replace('.', ',');
}

/** Dolar: 0.002 → "0,002 $"; 12.4 → "12,4 $". */
export function formatUsd(value: number): string {
  const digits = value !== 0 && Math.abs(value) < 0.1 ? 4 : 2;
  return `${formatDecimal(value, digits)} $`;
}

/** Metni `max` karaktere kırpar; kırpıldıysa sonuna "…" ekler. */
export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, Math.max(0, max - 1)).join('') + '…';
}
