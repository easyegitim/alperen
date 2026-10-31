/** /mod — oturum modunu kalıcı değiştirir; sistem kendiliğinden doğrudan moda geçmez. */
import { actionKeyboard } from '../../telegram/keyboard.ts';
import { buttons, texts } from '../../texts.ts';
import { saveSession, say, type Ctx } from '../context.ts';

export async function run(ctx: Ctx): Promise<void> {
  await say(ctx, texts.modeAsk, {
    keyboard: actionKeyboard([
      { text: buttons.staySocratic, data: 'mode:socratic' },
      { text: buttons.direct, data: 'mode:direct' },
    ]),
  });
}

export async function onMode(ctx: Ctx, mode: 'socratic' | 'direct'): Promise<void> {
  await saveSession(ctx, { mode });
  await ctx.db.updatePreferences({ default_mode: mode });
  await say(ctx, mode === 'direct' ? texts.modeDirect : texts.modeSocratic, { mode });
}
