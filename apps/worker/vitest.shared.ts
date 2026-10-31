/** Ortak Vite eklentisi: prompts/*.md dosyaları metin modülü olarak (wrangler.toml [[rules]] Text eşleniği). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

export const mdText: Plugin = {
  name: 'ogrenmen-md-text',
  enforce: 'pre',
  transform(code: string, id: string) {
    if (id.endsWith('.md')) return { code: `export default ${JSON.stringify(code)};`, map: null };
    return null;
  },
};

/**
 * `virtual:hukuk/<ad>`: docs/hukuk/<ad>.md metni (salt okunur, M12'nin dosyası). Workers havuzu repo
 * kökü dışındaki .md dosyasını Text kuralıyla yükleyemediği için içerik Vite'ta modüle çevrilir.
 */
const HUKUK_PREFIX = 'virtual:hukuk/';
export const hukukDocs: Plugin = {
  name: 'ogrenmen-hukuk-docs',
  enforce: 'pre',
  resolveId(id: string) {
    return id.startsWith(HUKUK_PREFIX) ? '\0' + id : null;
  },
  load(id: string) {
    if (!id.startsWith('\0' + HUKUK_PREFIX)) return null;
    const name = id.slice(HUKUK_PREFIX.length + 1);
    if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`geçersiz hukuk belgesi adı: ${name}`);
    const text = readFileSync(fileURLToPath(new URL(`../../docs/hukuk/${name}.md`, import.meta.url)), 'utf8');
    return `export default ${JSON.stringify(text)};`;
  },
};
