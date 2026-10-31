/**
 * Onay kapısı (§5.3): yaş beyanı → aydınlatma özeti → `record_student_consent('kvkk_aydinlatma')`.
 * Reşit değilse `awaiting_guardian`: veli onayını yalnız koordinatörün ürettiği kod/bağlantı açar; bot
 * onay yazamaz. Onay yokken bot yalnız onay mesajı gönderir; LLM çağrılmaz, mesaj içeriği saklanmaz.
 */
import { actionKeyboard } from '../../telegram/keyboard.ts';
import { buttons, texts } from '../../texts.ts';
import { ensureSession, saveSession, type Ctx } from '../context.ts';
import { extractConsentSummary, privacyBlock } from '../commands/gizlilik.ts';
import { offerDiagnosticOrHelp } from './diagnostic.ts';

const AGE_KB = actionKeyboard([
  { text: buttons.ageAdult, data: 'age:adult' },
  { text: buttons.ageMinor, data: 'age:minor' },
]);

const CONSENT_KB = actionKeyboard([
  { text: buttons.readText, data: 'consent:kvkk_aydinlatma:read' },
  { text: buttons.approve, data: 'consent:kvkk_aydinlatma:yes' },
  { text: buttons.notNow, data: 'consent:kvkk_aydinlatma:no' },
]);

const CONSENT_KB_AFTER_READ = actionKeyboard([
  { text: buttons.approve, data: 'consent:kvkk_aydinlatma:yes' },
  { text: buttons.notNow, data: 'consent:kvkk_aydinlatma:no' },
]);

/** /start sonrası: onay yoksa yaş sorusu; varsa teşhis teklifi. İlk cümle sabittir. */
export async function startFlow(ctx: Ctx): Promise<void> {
  const session = await ensureSession(ctx);
  if (ctx.identity.consent_ok) {
    if (session.state === 'awaiting_guardian' || session.state === 'awaiting_consent' || session.state === 'new') await saveSession(ctx, { state: 'idle' });
    await offerDiagnosticOrHelp(ctx, texts.start);
    return;
  }
  if (ctx.identity.is_minor === true && session.state === 'awaiting_guardian') {
    await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'consent', texts: [`${texts.start}\n${texts.guardianNeeded}`], guards: ['consent_missing'], inMessageId: ctx.messageRowId });
    return;
  }
  await saveSession(ctx, { state: 'awaiting_consent' });
  await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'consent', texts: [`${texts.start}\n${texts.ageQuestion}`], keyboard: AGE_KB, guards: ['consent_missing'], inMessageId: ctx.messageRowId });
}

async function retentionDays(ctx: Ctx): Promise<number> {
  return ctx.chat.retention_days > 0 ? ctx.chat.retention_days : 90;
}

export async function onAge(ctx: Ctx, adult: boolean): Promise<void> {
  const year = ctx.s.now().getUTCFullYear();
  await ctx.db.setBirthYear(adult ? year - 19 : year - 15);
  await saveSession(ctx, { state: 'awaiting_consent' });
  const days = await retentionDays(ctx);
  const legal = await ctx.db.latestLegalText('kvkk_aydinlatma').catch(() => null);
  const summary = legal === null ? null : extractConsentSummary(legal.body_md, days);
  await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'consent', texts: [summary ?? texts.consentSummary(days)], keyboard: CONSENT_KB, guards: ['consent_missing'] });
}

export async function onConsent(ctx: Ctx, choice: 'yes' | 'no' | 'read'): Promise<void> {
  if (choice === 'no') {
    await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'consent', texts: [texts.consentLater] });
    return;
  }
  if (choice === 'read') {
    const block = await privacyBlock(ctx);
    await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'consent', texts: [block ?? texts.privacyFallback], keyboard: CONSENT_KB_AFTER_READ });
    return;
  }
  const legal = await ctx.db.latestLegalText('kvkk_aydinlatma');
  if (legal === null) {
    await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'consent', texts: [texts.privacyFallback] });
    return;
  }
  await ctx.db.recordStudentConsent('kvkk_aydinlatma', legal.id, {
    chat_id: ctx.chatId,
    message_id: ctx.callback?.message?.message_id ?? ctx.message?.message_id ?? 0,
    telegram_user_id: ctx.actor.id,
  });
  const fresh = await ctx.db.resolveTelegram({ tgUser: ctx.actor.id, chat: ctx.chatId, username: ctx.actor.username, isGroup: false, create: false, firstName: null, lastName: null });
  ctx.identity = fresh;
  if (fresh.consent_ok === false) {
    await saveSession(ctx, { state: 'awaiting_guardian' });
    await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'consent', texts: [texts.guardianNeeded], guards: ['consent_missing'] });
    return;
  }
  await saveSession(ctx, { state: 'idle' });
  await offerDiagnosticOrHelp(ctx, null);
}

/**
 * Veli onayı sonradan geldiyse (oturum hâlâ `awaiting_guardian`, kimlik artık `consent_ok`) öğrenciye
 * bir kez "Velin onayladı, başlayabiliriz." gider ve oturum `idle` olur. `redeem_guardian_code` öğrencinin
 * sohbetini döndürmediği için bu bildirim öğrencinin bir sonraki temasında gönderilir (README not 10).
 */
export async function notifyGuardianApproved(ctx: Ctx): Promise<boolean> {
  if (ctx.identity.consent_ok === false || ctx.identity.student_id === null) return false;
  const session = await ensureSession(ctx);
  if (session.state !== 'awaiting_guardian') return false;
  await saveSession(ctx, { state: 'idle' });
  await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'consent', texts: [texts.guardianApprovedStudent], inMessageId: ctx.messageRowId });
  return true;
}

/**
 * Onay kapısı: true dönerse mesaj işlendi (onay mesajı gönderildi), akış durur.
 * Velinin onayı sonradan geldiyse öğrenciye bir kez "Velin onayladı" denir ve akış sürer.
 */
export async function consentGate(ctx: Ctx): Promise<boolean> {
  const session = await ensureSession(ctx);
  if (ctx.identity.consent_ok) {
    await notifyGuardianApproved(ctx);
    return false;
  }
  const text = session.state === 'awaiting_guardian' || (ctx.identity.is_minor === true && session.state !== 'awaiting_consent' && session.state !== 'new') ? texts.guardianNeeded : texts.consentRequired;
  await ctx.s.reply({ chatId: ctx.chatId, db: ctx.db, purpose: 'consent', texts: [text], guards: ['consent_missing'], inMessageId: ctx.messageRowId });
  return true;
}
