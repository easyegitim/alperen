/**
 * Front-matter ayrıştırıcı: prompt dosyalarının başındaki `---` blokları için küçük, deterministik bir YAML alt kümesi.
 *
 * Desteklenen biçimler (başka her şey OGR-PRM-001 ile reddedilir; sessizce yanlış okumaktansa düşmek iyidir):
 *   anahtar: değer            düz metin (tırnaklı ya da tırnaksız)
 *   anahtar: null | ~         null
 *   anahtar: [a, b, "c d"]    satır içi liste ([] boş liste)
 *   anahtar:                  blok liste; sonraki satırlar "  - öğe"
 *   # yorum                   yok sayılır
 * Sayı ve mantıksal değer yoktur: hepsi metin olarak döner, meta şeması (meta.ts) yorumlar.
 */
import { PromptError } from './errors.js';

export type FrontValue = string | null | string[];

export interface ParsedFile {
  data: Record<string, FrontValue>;
  body: string;
}

const KEY_LINE = /^([a-z][a-z0-9_]*):(?:\s+(.*))?$/;
const LIST_ITEM = /^\s+-\s+(.*)$/;

function unquote(raw: string, where: string): string {
  const s = raw.trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  if (/^["']/.test(s) || /["']$/.test(s)) throw new PromptError('OGR-PRM-001', `${where}: kapanmamış tırnak: ${s}`);
  return s;
}

function scalar(raw: string, where: string): FrontValue {
  const s = raw.trim();
  if (s === 'null' || s === '~') return null;
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) throw new PromptError('OGR-PRM-001', `${where}: satır içi liste ']' ile bitmeli`);
    const inner = s.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((p) => {
      const v = unquote(p, where);
      if (v === '') throw new PromptError('OGR-PRM-001', `${where}: boş liste öğesi`);
      return v;
    });
  }
  return unquote(s, where);
}

/**
 * Dosyayı front-matter ve gövdeye ayırır. Satır sonları LF'ye çevrilir; gövdenin baş ve sondaki boşlukları kırpılır.
 * `file` yalnız hata iletisi içindir.
 */
export function parseFrontMatter(source: string, file = '<metin>'): ParsedFile {
  const src = source.replace(/\r\n?/g, '\n');
  if (!src.startsWith('---\n')) throw new PromptError('OGR-PRM-001', `${file}: dosya '---' satırıyla başlamalı`);
  const end = src.indexOf('\n---', 3);
  if (end === -1) throw new PromptError('OGR-PRM-001', `${file}: front-matter kapanış '---' satırı yok`);
  const afterClose = src.slice(end + 4);
  if (afterClose !== '' && !afterClose.startsWith('\n')) {
    throw new PromptError('OGR-PRM-001', `${file}: kapanış satırı yalnız '---' olmalı`);
  }
  const lines = src.slice(4, end).split('\n');
  const data: Record<string, FrontValue> = {};
  let openList: string | null = null;
  lines.forEach((line, i) => {
    const where = `${file}:${i + 2}`;
    if (line.trim() === '' || line.trimStart().startsWith('#')) return;
    const item = LIST_ITEM.exec(line);
    if (item) {
      if (openList === null) throw new PromptError('OGR-PRM-001', `${where}: liste öğesi bir anahtarın altında olmalı`);
      const list = data[openList] as string[];
      list.push(unquote(item[1] ?? '', where));
      return;
    }
    const kv = KEY_LINE.exec(line);
    if (!kv) throw new PromptError('OGR-PRM-001', `${where}: 'anahtar: değer' bekleniyordu: ${line}`);
    const key = kv[1] as string;
    if (key in data) throw new PromptError('OGR-PRM-001', `${where}: yinelenen anahtar: ${key}`);
    const value = kv[2];
    if (value === undefined || value.trim() === '') {
      data[key] = [];
      openList = key;
    } else {
      data[key] = scalar(value, where);
      openList = null;
    }
  });
  return { data, body: afterClose.trim() };
}
