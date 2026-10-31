/**
 * /arastir <soru> — `runtime_flags.research_enabled` ve `enqueue_research` (kota RPC içinde,
 * `consume_quota('research')`; pilotta standard katman 0 → kapalı metni). Soru metni temizlenerek kuyruğa girer.
 */
import { DbError } from '../../data/repo.ts';
import { texts } from '../../texts.ts';
import { say, type Ctx } from '../context.ts';

export async function run(ctx: Ctx, args: string): Promise<void> {
  const query = args.trim();
  if (query === '') {
    await say(ctx, texts.arastirUsage);
    return;
  }
  const flags = await ctx.s.flags();
  if (flags.research_enabled !== true) {
    await say(ctx, texts.arastirClosed);
    return;
  }
  const clean = await ctx.s.scrubFor(ctx.chatId, query, ctx.selfRoles);
  try {
    await ctx.db.enqueueResearch(clean.text);
  } catch (err) {
    if (err instanceof DbError && (err.code === 'OGR-RES-001' || err.code === 'OGR-QUOTA-001')) {
      await say(ctx, texts.arastirClosed);
      return;
    }
    throw err;
  }
  await say(ctx, texts.arastirQueued, { piiReplacements: clean.replacements });
}
