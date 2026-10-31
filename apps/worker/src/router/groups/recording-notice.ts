/**
 * Grup kayıt bildirimi (§5.2 my_chat_member, §5.9, guven-ve-seffaflik.md): metin `legal_texts`
 * (`grup_kayit`, güncel sürüm, `grup-kayit-kisa` bloğu), gün = `tg_chats.retention_days`. Bot "Pin messages" hakkıyla
 * yöneticiyse sabitlenir; değilse sabitleme atlanır ve koordinatöre `instructor_alerts(ops)` açılır.
 * Gönderilen gün sayısı `recording_notice_days`'e yazılır; süre değişirse saatlik cron yeniler.
 */
import type { Db, TgChatRow } from '../../data/repo.ts';
import type { Services } from '../../services.ts';
import { texts } from '../../texts.ts';
import { bestEffort, log } from '../../ops/log.ts';
import { legalBlock } from '../legal-blocks.ts';

/**
 * Gruba giden kısa bildirim: `grup_kayit` gövdesindeki `grup-kayit-kisa` bloğu (belgenin tamamı değil);
 * gün sayısı gönderim anındaki `retention_days` ile yazılır. Metin yoksa `texts.recordingNoticeFallback`.
 */
export async function noticeText(db: Db, days: number): Promise<{ text: string; legalId: string | null }> {
  const legal = await db.latestLegalText('grup_kayit');
  const block = legal === null ? null : legalBlock(legal.body_md, 'grup-kayit-kisa', days, 'grup_kayit');
  return { text: block ?? texts.recordingNoticeFallback(days), legalId: legal?.id ?? null };
}

/** Bildirimi gönderir, mümkünse sabitler, tg_chats'i günceller. */
export async function sendRecordingNotice(s: Services, chat: TgChatRow, opts: { unpinOld: boolean }): Promise<number | null> {
  const db = s.db;
  const { text, legalId } = await noticeText(db, chat.retention_days);
  const res = await s.reply({ chatId: chat.chat_id, db, purpose: 'command', texts: [text] });
  const msg = res.sent[0];
  if (msg === undefined) return null;
  if (chat.bot_can_pin) {
    if (opts.unpinOld && chat.recording_notice_msg_id !== null) await s.tg.unpinChatMessage(chat.chat_id, chat.recording_notice_msg_id).catch(() => null);
    const pinned = await s.tg.pinChatMessage(chat.chat_id, msg.message_id).catch((err: unknown) => {
      log.warn('pin_failed', { chat: chat.chat_id, err: String(err) });
      return null;
    });
    if (pinned !== null) await bestEffort('ops_alert_failed', db.closeOpsAlert(texts.ops.notAdmin, { chat_id: chat.chat_id }));
  } else {
    await bestEffort('ops_alert_failed', db.openOpsAlert({ detail: texts.ops.notAdmin, severity: 'warning', ref: { chat_id: chat.chat_id } }));
  }
  await db.updateChat(chat.chat_id, { recording_notice_msg_id: msg.message_id, recording_notice_legal_id: legalId, recording_notice_days: chat.retention_days });
  return msg.message_id;
}
