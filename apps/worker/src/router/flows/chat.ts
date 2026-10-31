/**
 * Sohbet akışı (§5.5). Önce veritabanı, sonra LLM:
 *  1. bekleyen soruya şık/sayı cevabı → grade_attempt; şablon kalıpları (kota, ilerleme, tarih);
 *     yasak konu (not, puan, devamsızlık, ödeme) → onaylı olgu ya da hocaya devir; havuz isabeti.
 *  2. consume_quota('message') → check_spend('chat') → bağlam (≤ 2.200 giriş token) → yönlendirici.
 *  3. guard → log_bot_response (kayıt yoksa cevap yok) → gönderim → record_chat_observation (p ve
 *     evidence_count DEĞİŞMEZ) → havuz adayı.
 */
import { buttons, texts } from '../../texts.ts';
import { actionKeyboard, MAX_BUTTONS, type Button } from '../../telegram/keyboard.ts';
import type { TgReplyMarkup } from '../../telegram/types.ts';
import type { TutorReply } from '../../llm/structured.ts';
import { estimateTokens } from '../../util.ts';
import { buildChatPrompt, fillUsername, type BuiltPrompt } from '../../llm/prompts/build.ts';
import { routeComplete, SnapshotHealthStore } from '../../llm/router.ts';
import { TUTOR_REPLY_GEMINI_SCHEMA, TUTOR_REPLY_JSON_SCHEMA } from '../../llm/structured.ts';
import { checkReply, factMatchesTopic, forbiddenTopic, parseAnswer, templateIntent, wantsExplanation } from '../../llm/guard.ts';
import { chainForState } from '../../ops/spend.ts';
import { buildContext, renderFacts, renderMisconceptions, renderProfile, renderRecent, type ChatContext } from '../../memory/retrieve.ts';
import type { LlmLogMeta } from '../../services.ts';
import { ensureSession, saveSession, type Ctx } from '../context.ts';
import { onPracticeAnswer } from './practice.ts';
import { consumeMessageQuota, warnText } from './quota.ts';
import { escalationHandle } from '../groups/escalation.ts';
import { runKota } from '../commands/kota.ts';
import { runIlerleme } from '../commands/ilerleme.ts';

export interface ChatOptions {
  /** Öğrencinin (temizlenmemiş, kırpılmış) metni. */
  text: string;
  /** `messages.id` (bot_responses.in_message_id). */
  messageRowId: number | null;
  /** Grupta cevaplanan mesajın Telegram kimliği. */
  replyTo: number | null;
  group: boolean;
  staff: boolean;
  /** Cevabın önüne eklenecek bilgi satırları ("Mesajını kısaltarak okudum." vb.). */
  lead: string[];
  /** Patlama korumasıyla birleştirilen önceki mesaj. */
  mergedPrevious: string | null;
  /** Öğrencinin mesajı soru mu (cevaplanınca `answered_at`). */
  isQuestion: boolean;
  /** `bot_responses.purpose`: serbest metin `chat`, [İpucu al] düğmesi `hint`. */
  purpose?: 'chat' | 'hint';
}

type SuggestedButton = NonNullable<TutorReply['suggested_buttons']>[number];

/**
 * tutor-reply `suggested_buttons` → en çok 3 eylem düğmesi (yalnız özel sohbet; callback'ler yalnız orada
 * işlenir). `hint` → `hint:<mesaj>`, `ask_instructor` → `human:<mesaj>`, `show_solution` → `cevap:go`
 * (yalnız bekleyen soru varken; /cevap yolu). Yükseltilen cevapta düğme yoktur.
 */
export function suggestionKeyboard(suggested: readonly SuggestedButton[] | undefined, messageRowId: number | null, hasPendingQuestion: boolean): TgReplyMarkup | undefined {
  const ref = String(messageRowId ?? 0);
  const out: Button[] = [];
  for (const b of suggested ?? []) {
    if (b === 'hint') out.push({ text: buttons.hint, data: `hint:${ref}` });
    else if (b === 'ask_instructor') out.push({ text: buttons.askInstructor, data: `human:${ref}` });
    else if (b === 'show_solution' && hasPendingQuestion) out.push({ text: buttons.showSolution, data: 'cevap:go' });
  }
  const unique = out.filter((b, i) => out.findIndex((x) => x.data === b.data) === i).slice(0, MAX_BUTTONS);
  return unique.length === 0 ? undefined : actionKeyboard(unique);
}

/** Havuz adayı gövdesi: kişiye özel hitap yok (grupta `[KULLANICI]` etiketi ve `@kullanıcı_adı` atılır). */
export function poolBody(parts: readonly string[]): string {
  return parts
    .join('\n')
    .replace(/\[KULLANICI\][,:]?\s*/gu, '')
    .replace(/(^|\s)@[A-Za-z0-9_]{3,}[,:]?\s*/gu, '$1')
    .trim();
}

async function curriculumOf(ctx: Ctx): Promise<string | null> {
  const eid = ctx.identity.enrollment_id;
  if (eid === null) return null;
  return (await ctx.db.getEnrollment(eid))?.curriculum_id ?? null;
}

async function escalate(ctx: Ctx, o: ChatOptions, reason: 'bot_unsure' | 'grade_attendance_payment' | 'human_requested' | 'degraded', question: string | null): Promise<string | null> {
  await ctx.db.openEscalation(ctx.chatId, o.messageRowId, reason, question).catch(() => null);
  return o.group ? await escalationHandle(ctx, null) : null;
}

async function markAnswered(ctx: Ctx, o: ChatOptions): Promise<void> {
  if (o.isQuestion && o.messageRowId !== null) await ctx.db.markMessageAnswered(o.messageRowId, ctx.s.now().toISOString()).catch(() => undefined);
}

/** DB-önce kısa devreler; true → cevaplandı, LLM yok. */
async function shortCircuit(ctx: Ctx, o: ChatOptions, clean: string, piiCount: number): Promise<boolean> {
  const student = ctx.identity.student_id !== null && ctx.identity.enrollment_id !== null;
  if (student && !o.group) {
    const session = await ensureSession(ctx);
    const ans = parseAnswer(o.text);
    if (session.state === 'awaiting_answer' && session.pending_question_id !== null && ans !== null) {
      if (await onPracticeAnswer(ctx, session.pending_question_id, ans, null)) return true;
    }
    const intent = templateIntent(o.text);
    if (intent === 'quota') {
      await runKota(ctx);
      return true;
    }
    if (intent === 'progress') {
      await runIlerleme(ctx);
      return true;
    }
    if (intent === 'when') {
      const hits = (await ctx.db.retrieveMemory(null, clean, 5)).filter((f) => f.kind === 'deadline' || f.kind === 'instructor_fact');
      const best = hits.find((h) => h.score > 0) ?? null;
      if (best !== null) {
        await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'chat', texts: [texts.memoryDate(best.text)], inMessageId: o.messageRowId, piiReplacements: piiCount, store: { studentId: ctx.identity.student_id } });
        await markAnswered(ctx, o);
        return true;
      }
    }
  }
  const topic = forbiddenTopic(o.text);
  if (topic !== null) {
    const facts = student && ctx.identity.enrollment_id !== null ? await ctx.db.approvedFacts(ctx.identity.enrollment_id) : [];
    const fact = facts.find((f) => factMatchesTopic(topic, f.text)) ?? null;
    if (fact !== null) {
      await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'chat', texts: [texts.instructorNote(fact.text)], guards: ['forbidden_topic'], inMessageId: o.messageRowId, replyTo: o.replyTo, piiReplacements: piiCount });
    } else {
      await escalate(ctx, o, 'grade_attendance_payment', clean);
      await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'escalation', texts: [texts.handoff], guards: ['forbidden_topic'], inMessageId: o.messageRowId, replyTo: o.replyTo, escalated: true, piiReplacements: piiCount });
    }
    return true;
  }
  if (student && wantsExplanation(o.text) && ctx.identity.enrollment_id !== null) {
    const obs = await ctx.db.lastObservationContext(ctx.identity.enrollment_id);
    const cur = await curriculumOf(ctx);
    const session = o.group ? null : await ensureSession(ctx);
    if (obs !== null && cur !== null) {
      const pool = await ctx.db.findPool({ curriculum_id: cur, kind: 'explanation', skill_id: obs.skill_id, misconception_tag: obs.misconception_tag, mode: session?.mode ?? 'socratic' });
      if (pool !== null) {
        await ctx.db.poolHit(pool.id);
        await ctx.s.reply({
          chatId: ctx.chatId,
          db: ctx.db,
          purpose: 'chat',
          texts: [...o.lead, pool.body],
          mode: session?.mode ?? 'socratic',
          poolId: pool.id,
          cacheHit: true,
          inMessageId: o.messageRowId,
          replyTo: o.replyTo,
          piiReplacements: piiCount,
          store: { studentId: ctx.identity.student_id },
        });
        await markAnswered(ctx, o);
        return true;
      }
    }
  }
  return false;
}

function budgetPrompt(base: Omit<Parameters<typeof buildChatPrompt>[0], 'facts' | 'recent'>, c: ChatContext, budget: number): { prompt: BuiltPrompt; factIds: number[]; recentIds: number[] } {
  let facts = c.facts;
  let recent = c.recent;
  let studentText = base.studentText;
  for (let round = 0; round < 3; round++) {
    const prompt = buildChatPrompt({ ...base, studentText, facts: renderFacts(facts), recent: renderRecent(recent) });
    if (estimateTokens(prompt.promptText) <= budget || round === 2) return { prompt, factIds: facts.map((f) => f.fact_id), recentIds: recent.map((r) => r.id) };
    if (round === 0) {
      facts = facts.slice(0, 3);
      recent = recent.slice(0, 4);
    } else {
      const over = estimateTokens(prompt.promptText) - budget;
      studentText = Array.from(studentText).slice(0, Math.max(40, studentText.length - over * 4)).join('');
    }
  }
  throw new Error('ulaşılamaz');
}

export async function handleChat(ctx: Ctx, o: ChatOptions): Promise<void> {
  const combined = o.mergedPrevious === null ? o.text : `${o.mergedPrevious}\n${o.text}`;
  const lead = o.mergedPrevious === null ? o.lead : [...o.lead, texts.burst];
  const scrubbed = await ctx.s.scrubFor(ctx.chatId, combined, ctx.selfRoles);
  const clean = scrubbed.text;
  if (await shortCircuit(ctx, { ...o, lead }, clean, scrubbed.replacements)) return;

  const quota = await consumeMessageQuota(ctx, o.staff);
  if (quota.ok === false) return;
  const quotaState = quota.q === null ? null : { used: quota.q.used, limit: quota.q.daily_limit };

  const spend = await ctx.s.spend.state(ctx.db, 'chat');
  const chainName = chainForState(spend.state);
  const session = o.group || ctx.identity.student_id === null ? null : await ensureSession(ctx);
  const mode = session?.mode === 'direct' || session?.direct_once === true ? 'direct' : 'socratic';
  if (chainName === null) {
    const handle = await escalate(ctx, o, 'degraded', clean);
    await ctx.s.reply({
      chatId: ctx.chatId,
      db: ctx.db,
      purpose: 'degraded',
      texts: [handle === null ? texts.degraded : `${texts.degraded} ${handle}`],
      degraded: true,
      escalated: true,
      inMessageId: o.messageRowId,
      replyTo: o.replyTo,
      quota: quotaState,
      piiReplacements: scrubbed.replacements,
    });
    return;
  }

  const recentN = await ctx.s.setting('recent_messages', 6);
  const memoryK = await ctx.s.setting('memory_k', 5);
  const budget = await ctx.s.setting('chat_budget_tokens_in', 2200);
  const maxOut = await ctx.s.setting('chat_max_tokens_out', 220);
  const exclude = new Set<number>(o.messageRowId === null ? [] : [o.messageRowId]);
  const context = await buildContext({
    db: ctx.db,
    chatId: ctx.chatId,
    enrollmentId: ctx.identity.enrollment_id,
    studentText: clean,
    excludeMessageIds: exclude,
    session,
    embed: ctx.s.deps.embed,
    recentN,
    memoryK,
  });
  const built = budgetPrompt(
    {
      baseVersion: ctx.s.cfg.promptVersionChat,
      mode,
      hintLevel: session?.hint_level ?? 0,
      profile: renderProfile(context.profile),
      misconceptions: renderMisconceptions(context.profile),
      question: context.question,
      solution: context.solution,
      group: o.group ? { username: ctx.actor.username } : null,
      studentText: clean,
    },
    context,
    budget,
  );

  const health = new SnapshotHealthStore(await ctx.db.providerHealth(), (p, patch) => ctx.db.updateProviderHealth(p, patch));
  const result = await routeComplete(
    chainName,
    { purpose: o.group ? 'chat_group' : 'chat', system: built.prompt.system, messages: [{ role: 'user', content: built.prompt.user }], geminiSchema: TUTOR_REPLY_GEMINI_SCHEMA, jsonSchema: TUTOR_REPLY_JSON_SCHEMA, maxTokens: maxOut, temperature: 0.4 },
    {
      providers: ctx.s.deps.llm,
      health,
      now: () => ctx.s.now(),
      onConfigError: (provider, code) => ctx.s.notifyAdmin(texts.ops.providerConfig(provider, code)),
    },
  );

  const meta: LlmLogMeta = {
    promptVersion: built.prompt.promptVersion,
    promptHash: built.prompt.promptHash,
    promptText: built.prompt.promptText,
    provider: null,
    model: null,
    attempts: result.attempts,
    tokensIn: null,
    tokensOut: null,
    costUsd: Math.round(result.attempts.reduce((a, x) => a + x.cost_usd, 0) * 1e9) / 1e9,
    latencyMs: result.latencyMs,
    confidence: null,
    schemaValid: null,
    memoryFactIds: [],
    recentMessageIds: built.recentIds,
    guards: [],
  };

  if (result.ok === false) {
    if (result.allCooldown && spend.state === 'free_only') await ctx.s.notifyAdmin(texts.ops.spendState('degraded'));
    const handle = await escalate(ctx, o, 'degraded', clean);
    await ctx.s.reply({
      chatId: ctx.chatId,
      db: ctx.db,
      purpose: 'degraded',
      texts: [handle === null ? texts.degraded : `${texts.degraded} ${handle}`],
      llm: { ...meta, schemaValid: result.attempts.some((a) => a.status === 'bad_output') ? false : null },
      degraded: true,
      escalated: true,
      inMessageId: o.messageRowId,
      replyTo: o.replyTo,
      quota: quotaState,
      piiReplacements: scrubbed.replacements,
    });
    return;
  }

  const cur = await curriculumOf(ctx);
  const skillSet = cur === null ? new Set<string>() : (await ctx.s.skills(cur)).ids;
  const g = checkReply(result.reply, { knownFactIds: new Set(built.factIds), curriculumSkillIds: skillSet, studentText: clean });
  let messages = o.group && !o.staff ? fillUsername(g.messages, ctx.actor.username) : g.messages;
  if (g.escalate) {
    const handle = await escalate(ctx, o, g.escalateReason ?? 'bot_unsure', clean);
    if (handle !== null) messages = [`${messages.join(' ')} ${handle}`];
  }
  const warn = warnText(quota.q);
  const parts = [...lead, ...messages];
  const keyboard = o.group || g.escalate ? undefined : suggestionKeyboard(result.reply.suggested_buttons, o.messageRowId, (session?.pending_question_id ?? null) !== null);
  const sent = await ctx.s.reply({
    chatId: ctx.chatId,
    db: ctx.db,
    purpose: o.purpose ?? 'chat',
    texts: warn === null ? parts : [...parts, warn],
    ...(keyboard === undefined ? {} : { keyboard }),
    mode,
    llm: {
      ...meta,
      provider: result.provider,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      confidence: g.confidence,
      schemaValid: true,
      memoryFactIds: g.usedFactIds,
      guards: result.repaired ? [...g.guards, 'format_fix'] : g.guards,
    },
    escalated: g.escalate,
    inMessageId: o.messageRowId,
    replyTo: o.replyTo,
    quota: quotaState,
    piiReplacements: scrubbed.replacements,
    store: { studentId: ctx.identity.student_id },
  });
  if (sent.logged === false) return;
  await markAnswered(ctx, o);
  if (session !== null) await saveSession(ctx, { hint_level: result.reply.hint_level ?? session.hint_level, direct_once: session.pending_question_id === null ? false : session.direct_once });

  const eid = ctx.identity.enrollment_id;
  const skill = g.skillIds[0];
  if (eid !== null && skill !== undefined && o.messageRowId !== null) {
    const tag = result.reply.detected_misconception_tag;
    await ctx.db
      .recordChatObservation(eid, skill, tag === null ? 'chat_question' : 'chat_misconception', o.messageRowId, clean, tag)
      .catch(() => ctx.db.recordChatObservation(eid, skill, 'chat_question', o.messageRowId ?? 0, clean, null).catch(() => 0));
  }
  // Havuz adayı kişiye özel olmayan, kurallardan geçmiş ve kullanıcı adıyla DOLDURULMAMIŞ metinden kurulur:
  // havuz satırı onaydan sonra aynı kazanım/yanılgıdaki her öğrenciye gider (§9.2: kullanıcı adı PII).
  const body = poolBody(g.messages);
  if (result.reply.suggest_pool_save && g.confidence >= 0.8 && g.escalate === false && cur !== null && skill !== undefined && body !== '') {
    await ctx.db
      .insertPoolCandidate({ kind: 'explanation', curriculum_id: cur, skill_id: skill, misconception_tag: result.reply.detected_misconception_tag, mode, body, model: result.model, cost_usd: result.costUsd })
      .catch(() => undefined);
  }
}
