/**
 * Her 15 dakikada: `cron_group_auto_answer()` (yalnız `group_auto_answer_min > 0` gruplar) → her satır için o
 * öğrencinin başlığıyla normal sohbet akışı (kota, onay kapısı, tavan aynen); cevap `reply_to` ile
 * soruya, `bot_responses.in_message_id` yazılır → aynı soru ikinci kez seçilmez. Grup başına ≤ 3 soru.
 */
import type { Services } from '../services.ts';
import type { Ctx } from '../router/context.ts';
import { handleChat } from '../router/flows/chat.ts';
import { log } from '../ops/log.ts';

export const MAX_PER_GROUP = 3;

export async function runGroupAutoAnswer(s: Services): Promise<number> {
  const rows = await s.db.cronGroupAutoAnswer();
  const perChat = new Map<number, number>();
  let answered = 0;
  for (const row of rows) {
    const n = perChat.get(row.chat_id) ?? 0;
    if (n >= MAX_PER_GROUP) continue;
    perChat.set(row.chat_id, n + 1);
    const db = s.db.forStudent(row.student_id);
    const chat = await s.db.getChat(row.chat_id);
    if (chat === null) continue;
    const identity = await db.identityForStudent(row.chat_id);
    if (identity.consent_ok === false) continue;
    const msg = await db.getMessage(row.message_id);
    if (msg === null || msg.text_llm === null) continue;
    const ctx: Ctx = {
      s,
      update: { update_id: 0 },
      chatId: row.chat_id,
      chatKind: chat.kind,
      chat,
      actor: { id: 0, username: null, isBot: false },
      identity,
      db,
      messageRowId: row.message_id,
      truncated: false,
      session: null,
      selfRoles: {},
    };
    try {
      await handleChat(ctx, { text: msg.text_llm, messageRowId: row.message_id, replyTo: row.telegram_message_id, group: true, staff: false, lead: [], mergedPrevious: null, isQuestion: true });
      answered++;
    } catch (err) {
      log.error('auto_answer_failed', { chat: row.chat_id, err: String(err) });
    }
  }
  return answered;
}
