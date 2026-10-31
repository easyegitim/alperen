/**
 * Teşhis testi (§5.2 /test ilk kez; §5.3): `start_diagnostic` → `next_diagnostic_item` → `grade_attempt`
 * → `advance_diagnostic` … → `finish_diagnostic`. Cevap anahtarı yalnız `grade_attempt` gövdesinde
 * okunur; Worker doğru şıkkı hiç görmez. Sonuç pilotta şablonla anlatılır (LLM yok); yalnız
 * `runtime_flags.diag_summary_llm=true` iken `diagnostic-summary.v1` ile LLM anlatır, düşerse şablon.
 * Güvenilir olmayan (evidence_count < 5) kazanımlarda yüzde yazılmaz.
 */
import type { DiagnosticItem, DiagnosticResult } from '../../data/repo.ts';
import { buildDiagnosticSummaryPrompt } from '../../llm/prompts/build.ts';
import { routeComplete, SnapshotHealthStore } from '../../llm/router.ts';
import { TUTOR_REPLY_GEMINI_SCHEMA, TUTOR_REPLY_JSON_SCHEMA } from '../../llm/structured.ts';
import { checkReply } from '../../llm/guard.ts';
import { chainForState } from '../../ops/spend.ts';
import { log } from '../../ops/log.ts';
import { figurePhoto } from './practice.ts';
import { actionKeyboard, encodeAnswer, LOCKED, optionKeyboard, type AnswerCallback } from '../../telegram/keyboard.ts';
import { formatPercent } from '../../telegram/format.ts';
import { buttons, texts } from '../../texts.ts';
import { saveSession, ensureSession, type Ctx } from '../context.ts';
import { feedbackText, optionsLine } from './feedback.ts';

const OFFER_KB = actionKeyboard([
  { text: buttons.startTest, data: 'diag:continue' },
  { text: buttons.later, data: 'diag:later' },
]);

/** Onay tamsa: teşhis yapılmadıysa teklif, yapıldıysa kısa yönlendirme. */
export async function offerDiagnosticOrHelp(ctx: Ctx, lead: string | null): Promise<void> {
  const eid = ctx.identity.enrollment_id;
  const status = eid === null ? 'none' : await ctx.db.diagnosticStatus(eid);
  const body = status === 'finished' ? texts.diagNext : texts.diagOffer;
  await ctx.s.reply({
    chatId: ctx.chatId,
    db: ctx.db,
    purpose: 'command',
    texts: [lead === null ? body : `${lead}\n${body}`],
    ...(status === 'finished' ? {} : { keyboard: OFFER_KB }),
    inMessageId: ctx.messageRowId,
  });
}

export async function startDiagnostic(ctx: Ctx): Promise<void> {
  const eid = ctx.identity.enrollment_id;
  if (eid === null) return;
  const status = await ctx.db.diagnosticStatus(eid);
  if (status === 'none') {
    const q = await ctx.db.consumeQuota('test');
    if (q.allowed === false) {
      await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'quota', texts: [texts.testQuotaFull(q.daily_limit)], quota: { used: q.used, limit: q.daily_limit }, guards: ['quota'] });
      return;
    }
  }
  const sessionId = await ctx.db.startDiagnostic(eid, ctx.chatId);
  await saveSession(ctx, { state: 'diagnostic', diagnostic_session_id: sessionId, pending_question_id: null });
  const item = await ctx.db.nextDiagnosticItem(sessionId);
  if (item === null) {
    await finish(ctx, sessionId);
    return;
  }
  await sendItem(ctx, sessionId, item, status === 'in_progress' && item.idx > 1 ? texts.diagAlreadyRunning : null);
}

async function sendItem(ctx: Ctx, sessionId: string, item: DiagnosticItem, lead: string | null): Promise<void> {
  const lines = [texts.diagItem(item.idx, item.total, item.stem)];
  if (item.figure_png !== null && item.alt_text !== null) lines.push(texts.figureCaption(item.alt_text));
  lines.push(optionsLine(item.options));
  const parts = lead === null ? [lines.join('\n')] : [lead, lines.join('\n')];
  // Şekil soru parçasının fotoğrafıdır: önde bilgi satırı ("kaldığın yerden …") olsa da kaybolmaz.
  const photo = await figurePhoto(ctx, item.figure_png);
  await ctx.s.reply({
    chatId: ctx.chatId,
    db: ctx.db,
    purpose: 'command',
    texts: parts,
    keyboard: optionKeyboard((k) => encodeAnswer(sessionId, item.question_id, k)),
    ...(photo === null ? {} : { photo: { ...photo, part: parts.length - 1 } }),
  });
}

export async function onDiagnosticAnswer(ctx: Ctx, a: AnswerCallback): Promise<boolean> {
  const session = await ensureSession(ctx);
  if (session.diagnostic_session_id !== a.session || session.state !== 'diagnostic') return false;
  const eid = ctx.identity.enrollment_id;
  if (eid === null) return false;
  const current = await ctx.db.nextDiagnosticItem(a.session);
  if (current === null || current.question_id !== a.question) {
    if (ctx.callback) await ctx.s.tg.answerCallbackQuery(ctx.callback.id, texts.answerClosed).catch(() => null);
    return true;
  }
  const started = ctx.callback?.message?.date ?? null;
  const responseMs = started === null ? null : Math.max(0, ctx.s.now().getTime() - started * 1000);
  const grade = await ctx.db.gradeAttempt(eid, a.question, { key: a.key }, 'diagnostic', a.session, responseMs);
  if (ctx.callback?.message) await ctx.s.tg.editMessageReplyMarkup(ctx.chatId, ctx.callback.message.message_id, LOCKED).catch(() => null);
  const fb = await feedbackText(ctx, grade);
  await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'feedback', texts: [fb.text], poolId: fb.poolId, cacheHit: fb.poolId !== null });
  await ctx.db.advanceDiagnostic(a.session);
  const next = await ctx.db.nextDiagnosticItem(a.session);
  if (next === null) await finish(ctx, a.session);
  else await sendItem(ctx, a.session, next, null);
  return true;
}

async function finish(ctx: Ctx, sessionId: string): Promise<void> {
  const res = await ctx.db.finishDiagnostic(sessionId);
  await saveSession(ctx, { state: 'idle', pending_question_id: null });
  const weakest = res.weakest ?? [];
  const reliable = (res.per_skill ?? []).filter((r) => r.reliable);
  const flags = await ctx.s.flags().catch(() => ({}) as Record<string, unknown>);
  if (flags.diag_summary_llm === true && (await llmSummary(ctx, res))) return;
  const lines: string[] = [texts.diagDoneHead];
  if (weakest.length > 0) lines.push(texts.diagWeakest(weakest));
  if (reliable.length > 0) lines.push(reliable.slice(0, 2).map((r) => `${r.name} ${formatPercent(r.p)}`).join(' · '));
  else lines.push(texts.diagNoPercent);
  lines.push(texts.diagNext);
  await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'command', texts: [lines.slice(0, 4).join('\n')] });
}

const PERCENT = /%\s?\d+|\d+\s?%/gu;

/**
 * `diag_summary_llm=true` iken LLM anlatımı (§5.5): `diagnostic-summary.v1` + `finish_diagnostic` JSON'u →
 * yönlendirici (tutor-reply şeması) → guard → `log_bot_response` → gönderim. Model sunucunun vermediği bir
 * yüzde yazarsa, düşük güvende, harcama `degraded` iken ya da zincir düşerse false: şablon kullanılır.
 */
async function llmSummary(ctx: Ctx, res: DiagnosticResult): Promise<boolean> {
  const spend = await ctx.s.spend.state(ctx.db, 'chat').catch(() => null);
  const chainName = spend === null ? null : chainForState(spend.state);
  if (chainName === null) return false;
  const skills = (res.per_skill ?? []).map((r) => ({ name: r.name, reliable: r.reliable, percent: r.reliable ? formatPercent(r.p) : null }));
  const built = buildDiagnosticSummaryPrompt({ weakest: res.weakest ?? [], skills });
  const health = new SnapshotHealthStore(await ctx.db.providerHealth().catch(() => []), (p, patch) => ctx.db.updateProviderHealth(p, patch));
  const maxOut = await ctx.s.setting('chat_max_tokens_out', 220);
  const result = await routeComplete(
    chainName,
    { purpose: 'chat', system: built.system, messages: [{ role: 'user', content: built.user }], geminiSchema: TUTOR_REPLY_GEMINI_SCHEMA, jsonSchema: TUTOR_REPLY_JSON_SCHEMA, maxTokens: maxOut, temperature: 0.3 },
    { providers: ctx.s.deps.llm, health, now: () => ctx.s.now(), onConfigError: (provider, code) => ctx.s.notifyAdmin(texts.ops.providerConfig(provider, code)) },
  );
  if (result.ok === false) return false;
  const g = checkReply(result.reply, { knownFactIds: new Set(), curriculumSkillIds: new Set(), studentText: '' });
  if (g.escalate) return false;
  const allowed = new Set(skills.flatMap((s) => (s.percent === null ? [] : [s.percent.replace(/\s/g, '')])));
  const percents = g.messages.join('\n').match(PERCENT) ?? [];
  if (percents.some((p) => allowed.has(p.replace(/\s/g, '').replace(/^(\d+)%$/u, '%$1')) === false)) {
    log.warn('diag_summary_rejected', { chat: ctx.chatId, reason: 'percent_not_from_server' });
    return false;
  }
  await ctx.s.reply({
    chatId: ctx.chatId,
    db: ctx.db,
    purpose: 'command',
    texts: [...g.messages, texts.diagNext],
    llm: {
      promptVersion: built.promptVersion,
      promptHash: built.promptHash,
      promptText: built.promptText,
      provider: result.provider,
      model: result.model,
      attempts: result.attempts,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
      confidence: g.confidence,
      schemaValid: true,
      memoryFactIds: [],
      recentMessageIds: [],
      guards: result.repaired ? [...g.guards, 'format_fix'] : g.guards,
    },
  });
  return true;
}
