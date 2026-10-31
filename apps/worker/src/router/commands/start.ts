/** /start — ilk cümle sabit (telegram.md); ardından onay akışı ya da teşhis teklifi. */
import { texts } from '../../texts.ts';
import { say, type Ctx } from '../context.ts';
import { startFlow } from '../flows/consent.ts';

export async function run(ctx: Ctx): Promise<void> {
  if (ctx.chatKind !== 'private') return;
  if (ctx.identity.student_id === null) {
    await say(ctx, texts.start);
    return;
  }
  await startFlow(ctx);
}
