/** /sil — silme talebi: [Onaylıyorum · Vazgeç] → request_deletion() (koordinatöre; 30 gün). */
import { actionKeyboard } from '../../telegram/keyboard.ts';
import { buttons, texts } from '../../texts.ts';
import { say, type Ctx } from '../context.ts';

export async function run(ctx: Ctx): Promise<void> {
  await say(ctx, texts.silAsk, {
    keyboard: actionKeyboard([
      { text: buttons.approve, data: 'del:yes' },
      { text: buttons.cancel, data: 'del:no' },
    ]),
  });
}

export async function onDelete(ctx: Ctx, yes: boolean): Promise<void> {
  if (yes) await ctx.db.requestDeletion();
  await say(ctx, yes ? texts.silDone : texts.silCancel);
}
