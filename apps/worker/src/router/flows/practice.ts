/**
 * Pratik seti (§5.2 /test): `consume_quota('test')` → `next_practice_items(enrollment, 10)` (onaylı,
 * şekli verified ya da şekilsiz, görülmemiş, yalnız şablon/eğitmen soruları). Set kimliği set BAŞLARKEN
 * bir kez üretilir — `uuid(sha256("practice:" + enrollment + ":" + gün + ":" + o günkü test sayısı))` —
 * ve setin sonuna kadar taşınır: düğmede `callback_data`, yazılı cevap için soru mesajının
 * `messages.attachments` meta verisinde (`{kind:'practice_set', set_id}`). Gece yarısını geçen set aynı
 * kimlikte kalır; `sessionAttempts` sıfırlanmaz ve OGR-GRADE-002 tekrar denetimi geçerli kalır.
 * Şekil havuzdan gönderildiğinde `consume_quota('figure')` düşer (§5.4); hak bittiyse soru şekilsiz,
 * yalnız `alt_text` altyazısıyla gider.
 */
import { sha256Hex } from '@ogrenmen/pii';
import type { GradeResult, PracticeItem } from '../../data/repo.ts';
import { encodeAnswer, LOCKED, optionKeyboard } from '../../telegram/keyboard.ts';
import { texts } from '../../texts.ts';
import { istanbulDay } from '../../util.ts';
import { ensureSession, saveSession, type Ctx } from '../context.ts';
import { feedbackText, optionsLine } from './feedback.ts';
import { bestEffort, log } from '../../ops/log.ts';

export const PRACTICE_SET_SIZE = 10;

function hashUuid(seed: string): string {
  const h = sha256Hex(seed);
  const v = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${v}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

/** Set başında: bugünün test sayısından (bu set dahil) türetilir. */
async function newSetId(ctx: Ctx, eid: string): Promise<string> {
  const day = istanbulDay(ctx.s.now());
  const used = (await ctx.db.quotaUsage(day)).find((u) => u.kind === 'test')?.used ?? 0;
  return hashUuid(`practice:${eid}:${day}:${used}`);
}

export async function startPractice(ctx: Ctx): Promise<void> {
  const eid = ctx.identity.enrollment_id;
  if (eid === null) return;
  const q = await ctx.db.consumeQuota('test');
  if (q.allowed === false) {
    await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'quota', texts: [texts.testQuotaFull(q.daily_limit)], quota: { used: q.used, limit: q.daily_limit }, guards: ['quota'], inMessageId: ctx.messageRowId });
    return;
  }
  const items = await ctx.db.nextPracticeItems(eid, PRACTICE_SET_SIZE);
  const first = items[0];
  if (first === undefined) {
    const view = await ctx.db.masteryView(eid).catch(() => []);
    const weakest = [...view].sort((a, b) => a.p - b.p)[0];
    await bestEffort('ops_alert_failed', ctx.db.openOpsAlert({ detail: texts.ops.practiceEmpty(weakest?.skill_name ?? 'tüm kazanımlar'), severity: 'warning', ref: {}, student_id: ctx.identity.student_id }));
    await saveSession(ctx, { state: 'idle', pending_question_id: null });
    await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'command', texts: [texts.practiceEmpty], inMessageId: ctx.messageRowId });
    return;
  }
  const setId = await newSetId(ctx, eid);
  await sendQuestion(ctx, setId, first, 1);
}

/**
 * Havuz şekli gönderilecekse `consume_quota('figure')`; hak yoksa (ya da kota RPC'si düşerse) null —
 * soru metni ve `alt_text` altyazısı yine gider, yalnız sendPhoto yapılmaz.
 */
export async function figurePhoto(ctx: Ctx, figurePng: string | null): Promise<{ url: string } | null> {
  if (figurePng === null) return null;
  const q = await ctx.db.consumeQuota('figure').catch((err: unknown) => {
    log.warn('figure_quota_failed', { chat: ctx.chatId, err: err instanceof Error ? err.name : 'error' });
    return null;
  });
  if (q === null || q.allowed === false) return null;
  return { url: ctx.s.deps.storage.publicUrl(figurePng) };
}

async function sendQuestion(ctx: Ctx, setId: string, item: PracticeItem, idx: number): Promise<void> {
  await saveSession(ctx, { state: 'awaiting_answer', pending_question_id: item.question_id, hint_level: 0 });
  const lines = [texts.diagItem(idx, PRACTICE_SET_SIZE, item.stem)];
  if (item.figure_png !== null && item.alt_text !== null) lines.push(texts.figureCaption(item.alt_text));
  lines.push(optionsLine(item.options));
  const photo = await figurePhoto(ctx, item.figure_png);
  await ctx.s.reply({
    chatId: ctx.chatId,
    db: ctx.db,
    purpose: 'command',
    texts: [lines.join('\n')],
    ...(item.kind === 'mcq' ? { keyboard: optionKeyboard((k) => encodeAnswer(setId, item.question_id, k)) } : {}),
    ...(photo === null ? {} : { photo }),
    store: { studentId: ctx.identity.student_id, attachments: [{ kind: 'practice_set', set_id: setId }] },
  });
}

/** Yazılı cevap için set kimliği: son pratik sorusunun meta verisi; yoksa (eski mesaj silindi) yeniden türetilir. */
async function storedSetId(ctx: Ctx, eid: string): Promise<string> {
  const stored = await ctx.db.lastPracticeSetId(ctx.chatId).catch(() => null);
  return stored ?? (await newSetId(ctx, eid));
}

/**
 * Bekleyen pratik sorusuna cevap (düğme ya da yazı). `setId` düğmeden gelir; yazılı cevapta son pratik
 * sorusunun mesaj meta verisinden okunur. false: bekleyen soru bu değil.
 */
export async function onPracticeAnswer(ctx: Ctx, questionId: string, chosen: { key?: string; value?: string }, setIdFromButton: string | null): Promise<boolean> {
  const session = await ensureSession(ctx);
  const eid = ctx.identity.enrollment_id;
  if (eid === null || session.state !== 'awaiting_answer' || session.pending_question_id !== questionId) return false;
  const setId = setIdFromButton ?? (await storedSetId(ctx, eid));
  let grade: GradeResult;
  try {
    grade = await ctx.db.gradeAttempt(eid, questionId, chosen, 'practice', setId, null);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('OGR-GRADE-002')) {
      await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'feedback', texts: [texts.answerAlready] });
      return true;
    }
    throw err;
  }
  if (ctx.callback?.message) await ctx.s.tg.editMessageReplyMarkup(ctx.chatId, ctx.callback.message.message_id, LOCKED).catch(() => null);
  const fb = await feedbackText(ctx, grade);
  const parts = [fb.text];
  if (session.direct_once) {
    const sol = await ctx.db.revealSolution(eid, questionId);
    if (sol !== null) parts.push(texts.solution(sol));
  }
  await saveSession(ctx, { direct_once: false, hint_level: 0 });
  await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'feedback', texts: parts, poolId: fb.poolId, cacheHit: fb.poolId !== null, inMessageId: ctx.messageRowId });
  const stats = await ctx.db.sessionAttempts(setId);
  const next = stats.total >= PRACTICE_SET_SIZE ? undefined : (await ctx.db.nextPracticeItems(eid, PRACTICE_SET_SIZE))[0];
  if (next === undefined) {
    await saveSession(ctx, { state: 'idle', pending_question_id: null });
    await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'command', texts: [texts.practiceDone(stats.correct, stats.total)] });
    return true;
  }
  await sendQuestion(ctx, setId, next, stats.total + 1);
  return true;
}
