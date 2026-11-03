/**
 * memory-delta — Haiku 5.5 hafıza deltası (PLAN-v2 §3.1, §3.2): bir teşhisten sonra `patterns.md` vb.
 * dosyalara en çok 3 işlem. İşlemler hafıza aracı işleyicilerinden (`pgMemory`) geçirilir.
 * `op` ile ayrılan üç biçim: create {path, text}, str_replace {path, old_str, new_str}, insert {path, insert_line, text}.
 */
import { z } from 'zod';
import { MEMORY_PATH } from './common.js';
import { addIssue, byteLength, defineContract } from './kit.js';

export const MEMORY_FILE_MAX_BYTES = 8 * 1024;

export const memoryDelta = defineContract({
  name: 'memory-delta',
  title: 'MemoryDelta',
  description: 'Hafıza dosyalarına en çok 3 işlem: create, str_replace, insert. Yol yalnız /memories/ altında olur.',
  llmOutput: true,
  build: (c) => {
    const path = c.str({ max: 200, pattern: MEMORY_PATH, desc: '/memories/ altında dosya yolu' });
    return z.strictObject({
      ops: c.arr(
        c.variants('op', [
          z.strictObject({ op: z.literal('create'), path, text: c.str({ min: 1, max: MEMORY_FILE_MAX_BYTES }) }),
          z.strictObject({
            op: z.literal('str_replace'),
            path,
            old_str: c.str({ min: 1, max: 2000 }),
            new_str: c.str({ max: 2000 }),
          }),
          z.strictObject({
            op: z.literal('insert'),
            path,
            insert_line: c.int({ min: 0, max: 10000 }),
            text: c.str({ min: 1, max: 2000 }),
          }),
        ] as const),
        { max: 3 },
      ),
    });
  },
  refine: (v, ctx) => {
    v.ops.forEach((o, i) => {
      if (o.path.includes('..')) addIssue(ctx, ['ops', i, 'path'], 'yolda .. olamaz');
      if (o.op === 'create' && byteLength(o.text) > MEMORY_FILE_MAX_BYTES) addIssue(ctx, ['ops', i, 'text'], 'dosya 8 KB sınırını aşıyor');
      if (o.op === 'str_replace' && o.old_str === o.new_str) addIssue(ctx, ['ops', i, 'new_str'], 'old_str ile new_str aynı');
    });
  },
});

export type MemoryDelta = z.output<typeof memoryDelta.strict>;
export type MemoryOp = MemoryDelta['ops'][number];
