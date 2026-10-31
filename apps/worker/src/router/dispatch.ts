/**
 * dispatch(update) sırası (§5.2): dedup (`dedup_update`) → `tg_chats` upsert → `resolve_telegram`
 * (ad alanları YALNIZ bu çağrıya geçer; sonrasında güncelleme `stripNames` kopyasıyla dolaşır) →
 * üye olayları → onay kapısı → komut / callback / metin. `p_create=true` yalnız özel sohbette `/start`
 * ve serbest metin içindir; `/veli`, `/egitmen`, `/yardim`, `/gizlilik`, grup ve üye olayları `false`.
 */
import { nameTokenHashes, type RoleLabel } from '@ogrenmen/pii';
import type { ChatKind, ChatRoleRow, MessageInsert } from '../data/repo.ts';
import { isQuestion } from '../llm/guard.ts';
import { bestEffort, log } from '../ops/log.ts';
import type { Services } from '../services.ts';
import { decodeAnswer } from '../telegram/keyboard.ts';
import type { TgCallbackQuery, TgChat, TgMessage, TgUpdate, TgUser } from '../telegram/types.ts';
import { texts } from '../texts.ts';
import { MAX_TEXT_CHARS, ensureSession, saveSession, say, type Actor, type Ctx } from './context.ts';
import { COMMANDS, NO_CREATE } from './commands/index.ts';
import { onMode } from './commands/mod.ts';
import { onDelete } from './commands/sil.ts';
import { consentGate, notifyGuardianApproved, onAge, onConsent } from './flows/consent.ts';
import { privateEscalationText } from './commands/hoca.ts';
import { run as runCevap } from './commands/cevap.ts';
import { onDiagnosticAnswer, startDiagnostic } from './flows/diagnostic.ts';
import { onPracticeAnswer } from './flows/practice.ts';
import { handleChat } from './flows/chat.ts';
import { onGroupMessage } from './groups/mention.ts';
import { onBotMembership, onNewMember } from './groups/roles.ts';

const NAME_KEYS = new Set(['first_name', 'last_name']);

function selfRoles(role: RoleLabel | null, first: string | null, last: string | null): Record<string, RoleLabel> {
  if (role === null) return {};
  const name = [first ?? '', last ?? ''].join(' ').trim();
  if (name === '') return {};
  return Object.fromEntries(nameTokenHashes(name).map((h) => [h, role]));
}

/** Güncellemenin ad alanları ayıklanmış derin kopyası (log, prompt, messages, bot_responses hiçbirinde ad yok). */
export function stripNames<T>(update: T): T {
  return JSON.parse(JSON.stringify(update, (k, v: unknown) => (NAME_KEYS.has(k) ? undefined : v))) as T;
}

function chatOf(u: TgUpdate): TgChat | null {
  return u.message?.chat ?? u.edited_message?.chat ?? u.callback_query?.message?.chat ?? u.my_chat_member?.chat ?? u.chat_member?.chat ?? null;
}

function actorOf(u: TgUpdate): TgUser | null {
  return u.message?.from ?? u.edited_message?.from ?? u.callback_query?.from ?? u.my_chat_member?.from ?? u.chat_member?.from ?? null;
}

const COMMAND_RE = /^\/([a-z_]+)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/u;

export function parseCommand(text: string): { name: string; botName: string | null; args: string } | null {
  const m = COMMAND_RE.exec(text.trim());
  if (m === null) return null;
  return { name: (m[1] ?? '').toLowerCase(), botName: m[2] ?? null, args: (m[3] ?? '').trim() };
}

function messageText(msg: TgMessage): string | null {
  return msg.text ?? msg.caption ?? null;
}

export async function dispatch(s: Services, raw: TgUpdate): Promise<void> {
  if (typeof raw.update_id !== 'number') return;
  if ((await s.db.dedupUpdate(raw.update_id)) === false) return;
  if (raw.message?.text !== undefined && raw.message.chat.type === 'private' && raw.message.text.startsWith('/') === false) {
    await s.tg.sendChatAction(raw.message.chat.id).catch(() => null);
  }
  const rawActor = actorOf(raw);
  const firstName = rawActor?.first_name ?? null;
  const lastName = rawActor?.last_name ?? null;
  const update = stripNames(raw);
  const tgChat = chatOf(update);
  const from = actorOf(update);
  if (tgChat === null || from === null || tgChat.type === 'channel') return;
  const kind = tgChat.type as ChatKind;
  const chat = await s.db.upsertChat({ chat_id: tgChat.id, kind, title: kind === 'private' ? null : (tgChat.title ?? null) });

  // Üye olayı: yeni üyenin chat_roles satırı resolve'dan ÖNCE okunur ("iki yol da gelirse ikincisi sessiz").
  const joiners: TgUser[] = [];
  const cm = update.chat_member;
  if (cm && ['left', 'kicked'].includes(cm.old_chat_member.status) && ['member', 'administrator', 'restricted'].includes(cm.new_chat_member.status)) joiners.push(cm.new_chat_member.user);
  for (const u of update.message?.new_chat_members ?? []) joiners.push(u);
  const preexisting = new Map<number, ChatRoleRow | null>();
  for (const u of joiners) preexisting.set(u.id, await s.db.getChatRole(tgChat.id, u.id));

  const text = update.message ? messageText(update.message) : null;
  const cmd = text === null ? null : parseCommand(text);
  const isPrivate = kind === 'private';
  const create = isPrivate && update.message !== undefined && (cmd === null ? text !== null : cmd.name === 'start') && (cmd === null || NO_CREATE.has(cmd.name) === false);
  const identity = await s.db.resolveTelegram({
    tgUser: from.id,
    chat: tgChat.id,
    username: from.username ?? null,
    isGroup: isPrivate === false,
    create,
    firstName,
    lastName,
  });
  if (create && identity.student_id !== null) s.invalidateHashes(tgChat.id);
  const actor: Actor = { id: from.id, username: from.username ?? null, isBot: from.is_bot };
  const ctx: Ctx = {
    s,
    update,
    chatId: tgChat.id,
    chatKind: kind,
    chat,
    actor,
    identity,
    db: s.db.forStudent(identity.student_id),
    messageRowId: null,
    truncated: false,
    session: null,
    selfRoles: selfRoles(identity.student_id !== null ? 'ÖĞRENCİ' : identity.staff_id !== null ? 'EĞİTMEN' : null, firstName, lastName),
  };

  if (update.my_chat_member) {
    await onBotMembership(ctx, update.my_chat_member);
    return;
  }
  if (joiners.length > 0) {
    for (const u of joiners) await onNewMember(ctx, u, preexisting.get(u.id) ?? null);
    return;
  }
  if (update.chat_member) return;
  if (update.callback_query) {
    ctx.callback = update.callback_query;
    await onCallback(ctx, update.callback_query);
    return;
  }
  if (update.edited_message) {
    await onEdited(ctx, update.edited_message);
    return;
  }
  const msg = update.message;
  if (msg === undefined || actor.isBot) return;
  ctx.message = msg;
  await onMessage(ctx, msg, text, cmd);
}

async function storeMessage(ctx: Ctx, msg: TgMessage, text: string | null): Promise<{ isQ: boolean; storedText: boolean }> {
  const role = ctx.identity.role_in_chat ?? 'other';
  const staff = ctx.identity.staff_id !== null && ['instructor', 'coordinator', 'observer'].includes(role);
  const consented = ctx.identity.student_id !== null && ctx.identity.consent_ok;
  const keepText = text !== null && (consented || staff);
  const isQ = keepText ? isQuestion(text) : false;
  const clean = keepText ? await ctx.s.scrubFor(ctx.chatId, text, ctx.selfRoles) : null;
  const row: MessageInsert = {
    chat_id: ctx.chatId,
    telegram_message_id: msg.message_id,
    sender_role: role === 'bot' ? 'other' : role,
    student_id: ctx.identity.student_id,
    staff_id: staff ? ctx.identity.staff_id : null,
    reply_to_telegram_message_id: msg.reply_to_message?.message_id ?? null,
    text_raw: keepText ? text : null,
    text_llm: clean === null ? null : clean.text,
    attachments: keepText ? [] : [{ kind: 'meta', length: text === null ? 0 : Array.from(text).length, voice: msg.voice !== undefined || msg.audio !== undefined }],
    mentions_bot: false,
    is_question: keepText ? isQ : null,
    sent_at: new Date(msg.date * 1000).toISOString(),
  };
  const bot = await ctx.s.bot();
  row.mentions_bot = text !== null && bot.username !== undefined && text.toLowerCase().includes('@' + bot.username.toLowerCase());
  try {
    ctx.messageRowId = await ctx.db.insertMessage(row, { returnId: ctx.identity.student_id !== null });
  } catch (err) {
    log.warn('message_store_failed', { chat: ctx.chatId, err: String(err) });
    ctx.messageRowId = null;
  }
  return { isQ, storedText: keepText };
}

async function onMessage(ctx: Ctx, msg: TgMessage, rawText: string | null, cmd: ReturnType<typeof parseCommand>): Promise<void> {
  let text = rawText;
  if (text !== null && Array.from(text).length > MAX_TEXT_CHARS) {
    text = Array.from(text).slice(0, MAX_TEXT_CHARS).join('');
    ctx.truncated = true;
  }
  const isPrivate = ctx.chatKind === 'private';
  const session = isPrivate && ctx.identity.student_id !== null ? await ensureSession(ctx) : null;
  const lastActivity = session === null ? null : Date.parse(session.last_activity_at);
  const stored = await storeMessage(ctx, msg, text);
  if (session !== null) await saveSession(ctx, { last_activity_at: ctx.s.now().toISOString() });

  if (text === null) {
    if (msg.voice !== undefined || msg.audio !== undefined) {
      if (isPrivate || (await mentionedOrReplied(ctx, msg))) await say(ctx, texts.voice, { replyTo: isPrivate ? null : msg.message_id });
    }
    return;
  }
  const lead = ctx.truncated ? [texts.truncated] : [];

  if (cmd !== null) {
    const bot = await ctx.s.bot();
    if (cmd.botName !== null && bot.username !== undefined && cmd.botName.toLowerCase() !== bot.username.toLowerCase()) return;
    const spec = COMMANDS[cmd.name];
    if (spec === undefined) {
      if (isPrivate) await say(ctx, texts.unknownCommand);
      return;
    }
    if (isPrivate === false && spec.group === false) {
      if (cmd.botName !== null) await say(ctx, texts.privateOnly, { replyTo: msg.message_id });
      return;
    }
    if (spec.needsStudent && ctx.identity.student_id === null) {
      await say(ctx, texts.startFirst);
      return;
    }
    if (isPrivate && ctx.identity.student_id !== null && spec.beforeConsent === false && (await consentGate(ctx))) return;
    if (isPrivate && ctx.identity.student_id !== null && spec.beforeConsent && cmd.name !== 'start') await notifyGuardianApproved(ctx);
    await spec.run(ctx, cmd.args);
    return;
  }

  if (isPrivate === false) {
    await onGroupMessage(ctx, msg, text, { isQuestion: stored.isQ, lead });
    return;
  }

  if (ctx.identity.student_id === null) {
    if (ctx.identity.staff_id !== null) {
      await handleChat(ctx, { text, messageRowId: null, replyTo: null, group: false, staff: true, lead, mergedPrevious: null, isQuestion: false });
      return;
    }
    await say(ctx, texts.startFirst);
    return;
  }
  if (await consentGate(ctx)) return;
  const burstMs = (await ctx.s.setting('burst_seconds', 3)) * 1000;
  let merged: string | null = null;
  if (lastActivity !== null && ctx.s.now().getTime() - lastActivity < burstMs && ctx.messageRowId !== null) {
    const recent = await ctx.db.recentMessages(ctx.chatId, 3);
    const prev = recent.find((m) => m.id !== ctx.messageRowId && m.sender_role === 'student' && ctx.s.now().getTime() - Date.parse(m.sent_at) < burstMs + 60_000);
    merged = prev?.text ?? null;
  }
  await handleChat(ctx, { text, messageRowId: ctx.messageRowId, replyTo: null, group: false, staff: false, lead, mergedPrevious: merged, isQuestion: stored.isQ });
}

async function mentionedOrReplied(ctx: Ctx, msg: TgMessage): Promise<boolean> {
  const bot = await ctx.s.bot();
  return msg.reply_to_message?.from?.id === bot.id;
}

async function onEdited(ctx: Ctx, msg: TgMessage): Promise<void> {
  const text = messageText(msg);
  const role = ctx.identity.role_in_chat ?? 'other';
  const staff = ctx.identity.staff_id !== null && ['instructor', 'coordinator', 'observer'].includes(role);
  const keep = text !== null && ((ctx.identity.student_id !== null && ctx.identity.consent_ok) || staff);
  if (keep === false) return;
  const trimmed = Array.from(text).slice(0, MAX_TEXT_CHARS).join('');
  const clean = await ctx.s.scrubFor(ctx.chatId, trimmed, ctx.selfRoles);
  // §5.2 düzenlenen mesajın metnini günceller; §3.8 ise bot_runtime'a messages üzerinde yalnız
  // update(is_question, answered_at) verir (README not 11). Yazım en iyi çabadır: yetki yoksa akış düşmez.
  await bestEffort('message_edit_failed', ctx.db.updateMessageText(ctx.chatId, msg.message_id, { text_raw: trimmed, text_llm: clean.text, is_question: isQuestion(trimmed) }), { chat: ctx.chatId });
}

async function onCallback(ctx: Ctx, cb: TgCallbackQuery): Promise<void> {
  const data = cb.data ?? '';
  await ctx.s.tg.answerCallbackQuery(cb.id).catch(() => null);
  if (ctx.chatKind !== 'private' || ctx.identity.student_id === null) return;
  const [head, a1, a2] = data.split(':');
  if (head === 'age') return onAge(ctx, a1 === 'adult');
  if (head === 'consent' && a1 === 'kvkk_aydinlatma' && (a2 === 'yes' || a2 === 'no' || a2 === 'read')) return onConsent(ctx, a2);
  if (head === 'del') return onDelete(ctx, a1 === 'yes');
  if (await consentGate(ctx)) return;
  if (head === 'diag') {
    if (a1 === 'later') {
      await say(ctx, texts.diagLater);
      return;
    }
    await startDiagnostic(ctx);
    return;
  }
  if (head === 'mode' && (a1 === 'socratic' || a1 === 'direct')) return onMode(ctx, a1);
  if (head === 'ans') {
    const ans = decodeAnswer(data);
    if (ans === null) return;
    if (await onDiagnosticAnswer(ctx, ans)) return;
    if (await onPracticeAnswer(ctx, ans.question, { key: ans.key }, ans.session)) return;
    if (cb.message) await ctx.s.tg.editMessageReplyMarkup(ctx.chatId, cb.message.message_id, { inline_keyboard: [] }).catch(() => null);
    await say(ctx, texts.answerClosed);
    return;
  }
  if (head === 'hint') {
    // [İpucu al]: ipucu düzeyi bir artar (en çok 3), aynı Sokratik akış `purpose='hint'` ile koşar.
    const current = await ensureSession(ctx);
    await saveSession(ctx, { hint_level: Math.min(3, current.hint_level + 1) });
    await handleChat(ctx, { text: texts.hintRequest, messageRowId: null, replyTo: null, group: false, staff: false, lead: [], mergedPrevious: null, isQuestion: false, purpose: 'hint' });
    return;
  }
  if (head === 'human') {
    // [Hocaya sor]: /hoca ile aynı yükseltme ve hizmet seviyesine göre aynı metin.
    const ref = Number(a1);
    await ctx.db.openEscalation(ctx.chatId, Number.isInteger(ref) && ref > 0 ? ref : null, 'human_requested', null);
    await say(ctx, await privateEscalationText(ctx), { purpose: 'escalation', escalated: true, guards: ['human_requested'] });
    return;
  }
  if (head === 'cevap') {
    await runCevap(ctx);
  }
}
