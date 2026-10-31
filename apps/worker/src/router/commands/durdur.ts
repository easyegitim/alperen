/** /durdur — proaktif hatırlatmaları kapatır. */
import { texts } from '../../texts.ts';
import { say, type Ctx } from '../context.ts';

export async function run(ctx: Ctx): Promise<void> {
  await ctx.db.updatePreferences({ proactive_enabled: false });
  await say(ctx, texts.durdur);
}
