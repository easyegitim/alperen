/** /egitmen <kod> — eğitmenin kendi hesabını bağlar (`redeem_staff_code`; öğrenci yaratılmaz). */
import { DbError } from '../../data/repo.ts';
import { texts } from '../../texts.ts';
import { say, type Ctx } from '../context.ts';

export async function run(ctx: Ctx, args: string): Promise<void> {
  const code = args.trim().split(/\s+/)[0] ?? '';
  if (ctx.chatKind !== 'private' || code === '' || ctx.actor.username === null) {
    await say(ctx, texts.staffUsage);
    return;
  }
  try {
    const ok = await ctx.db.redeemStaffCode(code, ctx.actor.id, ctx.actor.username);
    if (ok) ctx.s.invalidateHashes(ctx.chatId);
    await say(ctx, ok ? texts.staffLinked(ctx.actor.username) : texts.staffInvalid);
  } catch (err) {
    if (err instanceof DbError && (err.code === 'OGR-STAFF-002' || err.code === 'OGR-STAFF-001')) {
      await say(ctx, texts.staffInvalid);
      return;
    }
    throw err;
  }
}
