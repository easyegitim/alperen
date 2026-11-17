// `bun run dump` — cases.json vakalarının gerçek çıktısını JSON olarak yazar.
// Python eşleniği `python -m ogrenmen_pii.dump`; CI iki çıktıyı diff ile karşılaştırır.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases, type CasesFile } from './cases.js';
import { config, nameTokenHashes, scrub, type ScrubOptions } from './scrub.js';

/** Hata mesajının başındaki OGR-XXX-NNN kodu; hata yoksa null (Python `error_code` ile aynı). */
export function errorCode(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    const m = /^OGR-[A-Z]+-[0-9]{3}/.exec(e instanceof Error ? e.message : String(e));
    return m ? m[0] : 'NO-CODE';
  }
}

export function buildDump(data: CasesFile): Record<string, unknown> {
  return {
    config: config(),
    hash_cases: data.hash_cases.map((hc) => ({ id: hc.id, hashes: nameTokenHashes(hc.full_name) })),
    cases: data.cases.map((c) => ({ id: c.id, ...scrub(c.text, c.opts) })),
    error_cases: data.error_cases.map((ec) => ({
      id: ec.id,
      error: errorCode(() => scrub(ec.text as string, ec.opts as ScrubOptions)),
    })),
  };
}

function main(argv: string[]): void {
  const i = argv.indexOf('--cases');
  const explicit = i >= 0 ? argv[i + 1] : undefined;
  process.stdout.write(JSON.stringify(buildDump(loadCases(explicit)), null, 2) + '\n');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
