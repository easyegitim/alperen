/**
 * Üye olayları (§5.2): `my_chat_member` (bot eklendi / hakları değişti) ve yeni üye
 * (`chat_member` — yalnız bot yöneticiyken gelir — ya da `message.new_chat_members` servis mesajı).
 * İki yol da gelirse ikincisi sessizdir (chat_roles zaten var).
 */
import type { ChatRoleRow } from '../../data/repo.ts';
import type { TgChatMemberUpdated, TgUser } from '../../telegram/types.ts';
import { texts } from '../../texts.ts';
import type { Ctx } from '../context.ts';
import { noticeText, sendRecordingNotice } from './recording-notice.ts';
import { bestEffort } from '../../ops/log.ts';

const PRESENT = new Set(['member', 'administrator', 'creator', 'restricted']);

export async function onBotMembership(ctx: Ctx, ev: TgChatMemberUpdated): Promise<void> {
  const status = ev.new_chat_member.status;
  if (PRESENT.has(status) === false) {
    await ctx.db.updateChat(ctx.chatId, { bot_is_admin: false, bot_can_pin: false });
    return;
  }
  const me = await ctx.s.tg.getMe();
  const privacyOff = me?.can_read_all_group_messages === true;
  const botId = me?.id ?? ev.new_chat_member.user.id;
  const member = await ctx.s.tg.getChatMember(ctx.chatId, botId);
  const isAdmin = member?.status === 'administrator' || member?.status === 'creator';
  const canPin = isAdmin && (member?.status === 'creator' || member?.can_pin_messages === true);
  await ctx.db.updateChat(ctx.chatId, { privacy_mode_off_verified: privacyOff, bot_is_admin: isAdmin, bot_can_pin: canPin });
  await ctx.db.upsertChatRole({ chat_id: ctx.chatId, telegram_user_id: botId, role: 'bot', student_id: null, staff_id: null, mention_handle: me?.username ? '@' + me.username : null });
  if (privacyOff) await bestEffort('ops_alert_failed', ctx.db.closeOpsAlert(texts.ops.privacyOn, { chat_id: ctx.chatId }));
  else await bestEffort('ops_alert_failed', ctx.db.openOpsAlert({ detail: texts.ops.privacyOn, severity: 'warning', ref: { chat_id: ctx.chatId } }));
  const chat = (await ctx.db.getChat(ctx.chatId)) ?? ctx.chat;
  const { legalId } = await noticeText(ctx.db, chat.retention_days);
  const alreadySent = chat.recording_notice_msg_id !== null && chat.recording_notice_days === chat.retention_days && chat.recording_notice_legal_id === legalId;
  if (alreadySent && chat.recording_notice_msg_id !== null) {
    if (canPin) {
      const pinned = await ctx.s.tg.pinChatMessage(ctx.chatId, chat.recording_notice_msg_id).catch(() => null);
      if (pinned !== null) await bestEffort('ops_alert_failed', ctx.db.closeOpsAlert(texts.ops.notAdmin, { chat_id: ctx.chatId }));
    } else {
      await bestEffort('ops_alert_failed', ctx.db.openOpsAlert({ detail: texts.ops.notAdmin, severity: 'warning', ref: { chat_id: ctx.chatId } }));
    }
    return;
  }
  await sendRecordingNotice(ctx.s, chat, { unpinOld: false });
}

/** Yeni üye: kayıt bildirimi gruba (üyeyi etiketlemeden) + özelden onay ipucu; chat_roles upsert. */
export async function onNewMember(ctx: Ctx, user: TgUser, preexisting: ChatRoleRow | null): Promise<void> {
  if (user.is_bot) return;
  if (preexisting !== null) return;
  const ident = await ctx.db.resolveTelegram({ tgUser: user.id, chat: ctx.chatId, username: user.username ?? null, isGroup: true, create: false, firstName: null, lastName: null });
  const role = await ctx.db.getChatRole(ctx.chatId, user.id);
  if (role === null) {
    await ctx.db.upsertChatRole({ chat_id: ctx.chatId, telegram_user_id: user.id, role: 'student', student_id: ident.student_id, staff_id: null, mention_handle: null });
  }
  ctx.s.invalidateHashes(ctx.chatId);
  const chat = (await ctx.db.getChat(ctx.chatId)) ?? ctx.chat;
  const { text } = await noticeText(ctx.db, chat.retention_days);
  await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'command', texts: [text, texts.newMemberHint] });
}
