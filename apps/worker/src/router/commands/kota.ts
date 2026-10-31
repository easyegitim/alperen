/** /kota — "Bugün 12/25 mesaj, 1/5 test kullandın. Yarın 00:00'da yenilenir." */
import { texts } from '../../texts.ts';
import { istanbulDay } from '../../util.ts';
import { say, type Ctx } from '../context.ts';

export async function runKota(ctx: Ctx): Promise<void> {
  const usage = await ctx.db.quotaUsage(istanbulDay(ctx.s.now()));
  const limits = await ctx.db.quotaLimits(ctx.identity.tier ?? 'standard');
  const used = (k: string): number => usage.find((u) => u.kind === k)?.used ?? 0;
  const limit = (k: string): number => limits.find((l) => l.kind === k)?.daily_limit ?? 0;
  await say(ctx, texts.kota(used('message'), limit('message'), used('test'), limit('test')));
}

export const run = runKota;
