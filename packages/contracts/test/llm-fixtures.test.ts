/**
 * Depo kökündeki `fixtures/llm/<amaç>/*.json` örnekleri (varsa) zod şemalarıyla doğrulanır.
 * `bad-schema.json` ve `injection.json` bilerek bozuktur: geçerli olmaları beklenmez (bad-schema düşmeli).
 * Yalnız v2'de zod karşılığı olan amaçlar kapsanır; v1'e özgü amaçların (chat, nightly_facts, research…) şeması
 * legacy JSON Schema olarak kalır ve Python tarafında sınanır.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contractRegistry, examItem, type SchemaName } from '../src/index.js';
import { ROOT } from './helpers.js';

const LLM_DIR = resolve(ROOT, '..', '..', 'fixtures', 'llm');
const MAP: Record<string, SchemaName> = {
  lesson_analysis: 'lesson-analysis',
  transcribe: 'transcript',
  diarize: 'transcript',
  vision_check: 'figure-render-report',
  weekly_summary: 'weekly-summary',
};

const dirs = existsSync(LLM_DIR) ? Object.keys(MAP).filter((d) => existsSync(join(LLM_DIR, d))) : [];

describe.skipIf(dirs.length === 0)('fixtures/llm', () => {
  for (const dir of dirs) {
    const files = readdirSync(join(LLM_DIR, dir)).filter((f) => f.endsWith('.json')).sort();
    const schema = MAP[dir] as SchemaName;
    describe(`${dir} -> ${schema}`, () => {
      for (const f of files) {
        it(f, () => {
          const data = JSON.parse(readFileSync(join(LLM_DIR, dir, f), 'utf8'));
          const ok = contractRegistry[schema].loose.safeParse(data).success;
          expect(ok).toBe(!f.startsWith('bad-'));
        });
      }
    });
  }

  it.skipIf(!existsSync(join(LLM_DIR, 'ocr')))('ocr -> exam-item[]', () => {
    for (const f of readdirSync(join(LLM_DIR, 'ocr')).filter((x) => x.endsWith('.json') && !x.startsWith('bad-'))) {
      const items = JSON.parse(readFileSync(join(LLM_DIR, 'ocr', f), 'utf8')) as unknown[];
      for (const item of items) expect(examItem.isValid(item), f).toBe(true);
    }
  });
});
