/** transcript — ders transkripti (v1 zod karşılığı): konuşmacı etiketli, isimsiz bölümler. Tek bölüm `transcript#/$defs/segment`. */
import { z } from 'zod';
import { speaker, timestamp } from './common.js';
import { defineContract } from './kit.js';

export const transcript = defineContract({
  name: 'transcript',
  title: 'Transcript',
  description: 'Ders transkripti: konuşmacı etiketli, isimsiz bölümler. Tek bölüm transcript#/$defs/segment ile doğrulanır.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      segments: c.arr(
        z.strictObject({
          t: timestamp(c),
          t_end: timestamp(c).optional(),
          speaker,
          text: c.str({ min: 1, max: 4000 }),
        }),
        { min: 1 },
      ),
    }),
  defs: { segment: ['properties', 'segments', 'items'] },
});

export type Transcript = z.output<typeof transcript.strict>;
export type TranscriptSegment = Transcript['segments'][number];
