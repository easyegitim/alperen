import { z } from 'zod';
import { copyModeFromEnv, writeCopy, type CopySource } from '../suggestions/copy.js';
import { planSuggestions, type SuggestionKind } from '../suggestions/rules.js';
import { collectSignals } from '../suggestions/signals.js';
import { systemPrompt } from '../prompts.js';
import { debounced } from './dedupe.js';
import { acceptCamelAliases, uuid } from './schemas.js';
import type { JobContext, JobDefinition } from './types.js';

const payload = acceptCamelAliases(
  { studentId: 'student_id' },
  z.object({
    /** Tek öğrenci; verilmezse etkin kaydı olan tüm öğrenciler için iş açılır (gece 03:30). */
    student_id: uuid.optional(),
    /** Tetikleyen olay ('nightly', 'practice.finished', 'onboarding', 'diagnosis' …); yalnız günlük için. */
    reason: z.string().max(64).optional(),
  }),
);

export type SuggestionsRefreshResult =
  | { mode: 'fanout'; students: number }
  | { mode: 'student'; studentId: string; written: number; kinds: SuggestionKind[]; copy: Partial<Record<CopySource, number>> };

/** Gece yayılımı: etkin kaydı olan her öğrenci için ayrı iş (öğrenci başına debounce: bekleyen yenileme varsa yinelenmez). */
async function fanOut(ctx: JobContext): Promise<SuggestionsRefreshResult> {
  const r = await ctx.db.query(
    `select distinct e.student_id from public.enrollments e join public.students s on s.id = e.student_id
      where e.status = 'active' and s.status = 'active' order by e.student_id`,
  );
  let n = 0;
  for (const row of r.rows) {
    const id = String(row.student_id);
    await ctx.enqueue('suggestions.refresh', { student_id: id, reason: 'nightly' }, debounced(`suggestions:${id}`));
    n++;
  }
  ctx.log.info('suggestions.refresh yayıldı', { students: n });
  return { mode: 'fanout', students: n };
}

/**
 * Öneri motoru (docs/PLAN-v2.md §13): sinyaller → kurallar (suggestions/rules.ts) → kart metni (suggestions_copy,
 * sahte kipte şablon) → `public.replace_suggestions` (aktif öneriler tek işlemde yenilenir; başlatılmışlar kalır).
 */
export const suggestionsRefreshJob: JobDefinition<z.infer<typeof payload>, SuggestionsRefreshResult> = {
  name: 'suggestions.refresh',
  description: 'Bugün kartlarını yeniden hesaplar (gece 03:30 ve her etkinlikten sonra).',
  process: 'worker',
  payload,
  concurrency: 4,
  retry: { retryLimit: 3, retryDelay: 15, retryBackoff: true, retryDelayMax: 600, expireInSeconds: 300, deleteAfterSeconds: 86_400 },
  handler: async (p, ctx) => {
    if (!p.student_id) return fanOut(ctx);
    const studentId = p.student_id;
    const now = ctx.now();
    const [signals, prev, ref] = await Promise.all([
      collectSignals(ctx.db, studentId, now),
      ctx.db.query(
        `select payload ->> 'copy_key' as copy_key, title, subtitle from public.suggestions
          where student_id = $1::uuid and consumed_at is null and payload ? 'copy_key'`,
        [studentId],
      ),
      ctx.db.query('select public_ref from public.students where id = $1::uuid', [studentId]),
    ]);
    if (!ref.rows[0]) {
      ctx.log.warn('suggestions.refresh: öğrenci yok', { studentId });
      return { mode: 'student', studentId, written: 0, kinds: [], copy: {} };
    }
    const cards = planSuggestions(signals);
    const mode = copyModeFromEnv();
    const system = mode === 'llm' && cards.length > 0 ? await systemPrompt(ctx.db, 'suggestions_copy') : null;
    const copies = await writeCopy(cards, {
      mode,
      gateway: ctx.gateway,
      system,
      studentRef: String(ref.rows[0].public_ref),
      previous: new Map(prev.rows.map((r) => [String(r.copy_key), { title: String(r.title), subtitle: r.subtitle === null ? null : String(r.subtitle) }])),
      log: ctx.log,
      signal: ctx.signal,
    });
    const items = cards.map((c, i) => ({
      kind: c.kind,
      title: copies[i]!.title,
      subtitle: copies[i]!.subtitle,
      payload: { ...c.payload, copy_key: c.key },
      rank: c.rank,
      enrollment_id: c.enrollment_id,
      expires_at: c.expires_at,
    }));
    const w = await ctx.db.query('select public.replace_suggestions($1::uuid, $2::jsonb) as n', [studentId, JSON.stringify(items)]);
    const written = Number(w.rows[0]?.n ?? items.length);
    const copy: Partial<Record<CopySource, number>> = {};
    for (const c of copies) copy[c.source] = (copy[c.source] ?? 0) + 1;
    ctx.log.info('öneriler yenilendi', { reason: p.reason ?? null, written, kinds: cards.map((c) => c.kind), copy });
    return { mode: 'student', studentId, written, kinds: cards.map((c) => c.kind), copy };
  },
};
