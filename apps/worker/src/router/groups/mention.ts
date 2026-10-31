/**
 * Grup mesajları (§5.2, §5.8, §12 #55): bot yalnız etiketlendiğinde ya da bota yanıt verildiğinde
 * konuşur; `@hoca` / `@<eğitmen>` içeren mesajda sessizdir. Soru işaretli mesajlara kendiliğinden
 * yanıt varsayılan kapalıdır (cron `cron_group_auto_answer`). Onaysız üyenin mesajı yalnız meta
 * veriyle saklanır; bu üye botu etiketlerse bir kez (7 günde bir) özel sohbete yönlendirilir, LLM yok.
 */
import { texts } from '../../texts.ts';
import { log } from '../../ops/log.ts';
import type { TgMessage } from '../../telegram/types.ts';
import type { Ctx } from '../context.ts';
import { handleChat } from '../flows/chat.ts';

const STAFF_ROLES = new Set(['instructor', 'coordinator', 'observer']);
const PROMPT_EVERY_MS = 7 * 86_400_000;

export function mentionsBot(msg: TgMessage, botUsername: string, botId: number): boolean {
  const text = msg.text ?? '';
  const handle = '@' + botUsername.toLowerCase();
  if ((msg.entities ?? []).some((e) => e.type === 'mention' && text.slice(e.offset, e.offset + e.length).toLowerCase() === handle)) return true;
  if (text.toLowerCase().includes(handle)) return true;
  return msg.reply_to_message?.from?.id === botId && botId !== 0;
}

/** `@hoca` ya da bağlı bir eğitmenin tanıtıcısı geçiyor mu (bot sessiz kalır). */
export async function mentionsStaff(ctx: Ctx, text: string): Promise<boolean> {
  if (/(^|\s)@hoca\b/iu.test(text)) return true;
  const staff = await ctx.db.chatStaff(ctx.chatId).catch((err: unknown) => {
    log.warn('chat_staff_failed', { chat: ctx.chatId, err: err instanceof Error ? err.name : 'error' });
    return [];
  });
  const lower = text.toLowerCase();
  return staff.some((s) => s.mention_handle !== null && lower.includes(s.mention_handle.toLowerCase()));
}

export async function onGroupMessage(ctx: Ctx, msg: TgMessage, text: string, opts: { isQuestion: boolean; lead: string[] }): Promise<void> {
  const role = ctx.identity.role_in_chat;
  const isStaff = ctx.identity.staff_id !== null && role !== null && STAFF_ROLES.has(role);
  if (isStaff && msg.reply_to_message !== undefined) {
    await ctx.db.markAnswered(ctx.chatId, msg.reply_to_message.message_id, ctx.actor.id);
  }
  const bot = await ctx.s.bot();
  if (mentionsBot(msg, bot.username ?? '', bot.id) === false) return;
  if (await mentionsStaff(ctx, text)) return;
  if (isStaff) {
    if (role === 'observer') return;
    await handleChat(ctx, { text, messageRowId: ctx.messageRowId, replyTo: msg.message_id, group: true, staff: true, lead: opts.lead, mergedPrevious: null, isQuestion: opts.isQuestion });
    return;
  }
  if (ctx.identity.student_id !== null && ctx.identity.consent_ok) {
    if (role === 'other') await ctx.db.upsertChatRole({ chat_id: ctx.chatId, telegram_user_id: ctx.actor.id, role: 'student', student_id: ctx.identity.student_id, staff_id: null, mention_handle: null });
    await handleChat(ctx, { text, messageRowId: ctx.messageRowId, replyTo: msg.message_id, group: true, staff: false, lead: opts.lead, mergedPrevious: null, isQuestion: opts.isQuestion });
    return;
  }
  // Onaysız üye: bir kez yönlendirme; sonra 7 günde bir. İz chat_roles'tadır (role='other', joined_at = son yönlendirme).
  const cr = await ctx.db.getChatRole(ctx.chatId, ctx.actor.id);
  const now = ctx.s.now();
  if (cr !== null && cr.role === 'other' && now.getTime() - Date.parse(cr.joined_at) < PROMPT_EVERY_MS) return;
  const link = `https://t.me/${bot.username ?? 'ogrenmen_bot'}?start=grup`;
  await ctx.s.reply({ chatId: ctx.chatId, db: ctx.s.db, purpose: 'consent', texts: [texts.groupConsentPrompt(ctx.actor.username, link)], guards: ['consent_missing'], replyTo: msg.message_id });
  await ctx.db.upsertChatRole({ chat_id: ctx.chatId, telegram_user_id: ctx.actor.id, role: 'other', student_id: ctx.identity.student_id, staff_id: null, mention_handle: null, joined_at: now.toISOString() });
}
