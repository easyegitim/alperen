/** /baslat — proaktif hatırlatmaları açar (Telegram komut adında Türkçe karakter yok). */
import { texts } from '../../texts.ts';
import { say, type Ctx } from '../context.ts';

export async function run(ctx: Ctx): Promise<void> {
  await ctx.db.updatePreferences({ proactive_enabled: true });
  await say(ctx, texts.baslat);
}
