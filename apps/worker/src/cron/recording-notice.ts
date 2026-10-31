/**
 * Saatlik: `recording_notice_days ≠ retention_days` olan gruplara güncel `grup_kayit` metni
 * (`{days}` = retention_days) gönderilir; `bot_can_pin` ise yeni mesaj sabitlenir (eskisi kaldırılır),
 * `recording_notice_msg_id/legal_id/days` güncellenir (storage_pressure 90→60 geçişi gruba böyle ulaşır).
 */
import type { Services } from '../services.ts';
import { sendRecordingNotice } from '../router/groups/recording-notice.ts';

export async function runRecordingNoticeRefresh(s: Services): Promise<number> {
  const chats = await s.db.chatsWithStaleNotice();
  let n = 0;
  for (const chat of chats) {
    if (chat.recording_notice_days === null && chat.recording_notice_msg_id === null && chat.bot_is_admin === false && chat.privacy_mode_off_verified === false) continue;
    const id = await sendRecordingNotice(s, chat, { unpinOld: true });
    if (id !== null) n++;
  }
  return n;
}
