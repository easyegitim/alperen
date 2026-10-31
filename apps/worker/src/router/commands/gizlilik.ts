/**
 * /gizlilik — aydınlatma metninin çocuk dili paragrafı VERİTABANINDAN: `legal_texts(kvkk_aydinlatma)`
 * güncel `body_md` içinde `<!-- ogrenmen:cocuk-dili:start -->` … `end` arası. Bu metnin kopyası
 * texts.ts'te yoktur. Ham `{{…}}` yer tutucusu görülürse blok gösterilmez (console.warn).
 */
import { texts } from '../../texts.ts';
import { legalBlock, markedBlock } from '../legal-blocks.ts';
import { say, type Ctx } from '../context.ts';

export function extractChildBlock(body: string): string | null {
  return legalBlock(body, 'cocuk-dili', null, 'kvkk_aydinlatma');
}

/** /start onay ekranı özeti: `onay-ozeti` bloğu (yalnız işaret varsa), gün = sohbetin saklama süresi. */
export function extractConsentSummary(body: string, days: number): string | null {
  return markedBlock(body, 'onay-ozeti') === null ? null : legalBlock(body, 'onay-ozeti', days, 'kvkk_aydinlatma');
}

export async function privacyBlock(ctx: Ctx): Promise<string | null> {
  const legal = await ctx.db.latestLegalText('kvkk_aydinlatma');
  return legal === null ? null : extractChildBlock(legal.body_md);
}

export async function run(ctx: Ctx): Promise<void> {
  const block = await privacyBlock(ctx);
  await say(ctx, block ?? texts.privacyFallback);
}
