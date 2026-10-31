/**
 * `legal_texts.body_md` içindeki işaretli bloklar (docs/hukuk/README.md "İşaretler"): `export-sql.py`
 * işaretleri gövdede korur ve yalnız `{{…}}` yer tutucularını yükleme anında çözer. Worker gruba ya da
 * öğrenciye belgenin tamamını değil, ilgili kısa bloğu gönderir.
 */
import { log } from '../ops/log.ts';

export type LegalBlock = 'cocuk-dili' | 'onay-ozeti' | 'grup-kayit-kisa' | 'grup-kayit-uzun';

const MAX_LINES = 4;

/** İşaretler arasındaki metin; işaret yoksa null. */
export function markedBlock(body: string, name: LegalBlock): string | null {
  const start = `<!-- ogrenmen:${name}:start -->`;
  const end = `<!-- ogrenmen:${name}:end -->`;
  const a = body.indexOf(start);
  const b = body.indexOf(end);
  if (a < 0 || b <= a) return null;
  const block = body.slice(a + start.length, b).trim();
  return block === '' ? null : block;
}

/** İşaretsiz gövde için: başlık (#), uyarı (>), kod çiti ve HTML yorumu olmayan ilk en çok 4 dolu satır. */
export function plainLines(body: string): string | null {
  let fence = false;
  const lines: string[] = [];
  for (const raw of body.split('\n')) {
    const l = raw.trim();
    if (l.startsWith('```')) {
      fence = !fence;
      continue;
    }
    if (fence || l === '' || l.startsWith('#') || l.startsWith('>') || l.startsWith('<!--')) continue;
    lines.push(l);
    if (lines.length === MAX_LINES) break;
  }
  return lines.length === 0 ? null : lines.join('\n');
}

const DAYS_TOKEN = /\{days\}|\{\{RETENTION_MESSAGES_DAYS\}\}/g;
/** Yükleme anında çözülmüş süre ("90 gün sonra silinir/siler") gönderim anındaki süreyle değiştirilir. */
const DAYS_RESOLVED = /\b\d+(\s+gün\s+sonra\s+(?:silinir|siler|silinecek))/gu;

/** Gün sayısını gönderim anındaki değerle yazar (§9.1: metindeki süre saklanan süreyle aynı olmalı). */
export function fillDays(text: string, days: number): string {
  return text.replace(DAYS_TOKEN, String(days)).replace(DAYS_RESOLVED, `${days}$1`);
}

/** Bloğu çıkarır ve günleri doldurur; çözülmemiş `{{…}}` kalırsa null (console.warn). */
export function legalBlock(body: string, name: LegalBlock, days: number | null, kind: string): string | null {
  const raw = markedBlock(body, name) ?? plainLines(body);
  if (raw === null) return null;
  const text = days === null ? raw : fillDays(raw, days);
  if (text.includes('{{')) {
    log.warn('legal_placeholder_unresolved', { kind });
    return null;
  }
  return text;
}
