/** memory-compaction — gece Sonnet 5.5 (Batch) hafıza sıkıştırma (PLAN-v2 §3.4): >6 KB dosyayı <=4 KB'a yazar. */
import { z } from 'zod';
import { MEMORY_PATH } from './common.js';
import { addIssue, byteLength, defineContract } from './kit.js';

export const MEMORY_COMPACT_MAX_BYTES = 4 * 1024;

export const memoryCompaction = defineContract({
  name: 'memory-compaction',
  title: 'MemoryCompaction',
  description: 'Sıkıştırılmış hafıza dosyaları: yol ve yeni içerik (her biri en çok 4 KB).',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      files: c.arr(
        z.strictObject({
          path: c.str({ max: 200, pattern: MEMORY_PATH }),
          content: c.str({ min: 1, max: MEMORY_COMPACT_MAX_BYTES * 2, desc: 'Yeni dosya içeriği; en çok 4 KB' }),
        }),
        { min: 1, max: 12 },
      ),
    }),
  refine: (v, ctx) => {
    const paths = new Set<string>();
    v.files.forEach((f, i) => {
      if (paths.has(f.path)) addIssue(ctx, ['files', i, 'path'], `yinelenen yol: ${f.path}`);
      paths.add(f.path);
      if (f.path.includes('..')) addIssue(ctx, ['files', i, 'path'], 'yolda .. olamaz');
      if (byteLength(f.content) > MEMORY_COMPACT_MAX_BYTES) addIssue(ctx, ['files', i, 'content'], 'içerik 4 KB sınırını aşıyor');
    });
  },
});

export type MemoryCompaction = z.output<typeof memoryCompaction.strict>;
