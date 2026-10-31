/**
 * /veli <kod> — velinin KENDİ Telegram hesabından. `resolve_telegram(p_create=false)`: veli öğrenci
 * olarak kaydedilmez; kimliği yalnız `secure.guardian_codes.used_by_telegram_user_id`'ye yazılır.
 * Öğrenciye "Velin onayladı" bir sonraki mesajında (onay kapısı) gider.
 */
import { DbError } from '../../data/repo.ts';
import { texts } from '../../texts.ts';
import { say, type Ctx } from '../context.ts';

export async function run(ctx: Ctx, args: string): Promise<void> {
  if (ctx.chatKind !== 'private') {
    await say(ctx, texts.privateOnly);
    return;
  }
  const code = args.trim().split(/\s+/)[0] ?? '';
  if (code === '') {
    await say(ctx, texts.guardianUsage);
    return;
  }
  try {
    const ok = await ctx.db.redeemGuardianCode(code, ctx.actor.id, { chat_id: ctx.chatId, message_id: ctx.message?.message_id ?? 0, telegram_user_id: ctx.actor.id });
    await say(ctx, ok ? texts.guardianRecorded : texts.guardianInvalid, { purpose: 'consent' });
  } catch (err) {
    if (err instanceof DbError && err.code === 'OGR-CONS-003') {
      await say(ctx, texts.guardianSelf, { purpose: 'consent' });
      return;
    }
    throw err;
  }
}
