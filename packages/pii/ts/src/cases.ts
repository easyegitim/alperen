// packages/pii/cases.json yükleyici (dump ve testler ortak kullanır).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Replacement, ScrubOptions } from './scrub.js';

export interface HashCase {
  id: string;
  full_name: string;
  expected: string[];
}
export interface PiiCase {
  id: string;
  note: string;
  text: string;
  opts: ScrubOptions;
  expected: { text: string; replacements: Replacement[] };
}
/** Hatalı girdi vakası: `text`/`opts` bilerek yanlış tiplidir; beklenen OGR-SCR-00x kodu. */
export interface ErrorCase {
  id: string;
  note: string;
  text: unknown;
  opts: unknown;
  expected_error: string;
}
export interface CasesFile {
  version: string;
  description: string;
  hash_cases: HashCase[];
  cases: PiiCase[];
  error_cases: ErrorCase[];
}

/** Vaka dosyasının yolu: açık argüman > OGRENMEN_PII_CASES > depo içi varsayılan. */
export function casesPath(explicit?: string): string {
  if (explicit) return explicit;
  const env = process.env.OGRENMEN_PII_CASES;
  if (env) return env;
  // packages/pii/ts/src/cases.ts → packages/pii/cases.json
  return fileURLToPath(new URL('../../cases.json', import.meta.url));
}

export function loadCases(explicit?: string): CasesFile {
  return JSON.parse(readFileSync(casesPath(explicit), 'utf8')) as CasesFile;
}
