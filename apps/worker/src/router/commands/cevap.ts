/** /cevap — yalnız bekleyen soru için doğrudan çözüm (`direct_once`); çözüm sunucudan (`reveal_solution`), LLM yok. */
import { texts } from '../../texts.ts';
import { ensureSession, saveSession, say, type Ctx } from '../context.ts';

export async function run(ctx: Ctx): Promise<void> {
  const session = await ensureSession(ctx);
  const eid = ctx.identity.enrollment_id;
  if (session.pending_question_id === null || eid === null) {
    await say(ctx, texts.cevapNone);
    return;
  }
  await saveSession(ctx, { direct_once: true });
  const sol = await ctx.db.revealSolution(eid, session.pending_question_id);
  await say(ctx, sol === null ? [texts.cevapOn] : [texts.cevapOn, texts.solution(sol)], { mode: 'direct' });
}
