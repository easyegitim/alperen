/**
 * /hoca <metin> — grupta branş eğitmenini etiketler; özelde iletir. `open_escalation(human_requested)`.
 * Grupta onaysız üye (öğrenci onayı yok ya da tanınmayan `other` üye) de hocayı çağırabilir; ama bu
 * üyenin metni saklanmaz (§5.2, §9.1, §12 #55): yükseltme `question_text = null` ile açılır, yalnız meta veri.
 */
import { texts } from '../../texts.ts';
import { say, type Ctx } from '../context.ts';
import { escalationHandle } from '../groups/escalation.ts';

const STAFF_ROLES = new Set(['instructor', 'coordinator', 'observer']);

/** Gönderenin metni saklanabilir mi: onaylı öğrenci ya da bağlı personel. */
export function mayStoreText(ctx: Ctx): boolean {
  if (ctx.identity.student_id !== null && ctx.identity.consent_ok) return true;
  const role = ctx.identity.role_in_chat;
  return ctx.identity.staff_id !== null && role !== null && STAFF_ROLES.has(role);
}

/** Özel sohbette yükseltme cevabı: hizmet seviyesine göre (§5.4). */
export async function privateEscalationText(ctx: Ctx): Promise<string> {
  const sla = ctx.identity.service_level === 'ai_plus_advisor' ? await advisorSla(ctx) : null;
  return sla === null ? texts.hocaPrivateAiOnly : texts.hocaPrivateAdvisor(sla);
}

export async function run(ctx: Ctx, args: string): Promise<void> {
  const firstWord = args.trim().split(/\s+/)[0] ?? '';
  const subject = /^(matematik|fizik|kimya|biyoloji|türkçe|geometri)$/iu.test(firstWord) ? firstWord : null;
  const store = mayStoreText(ctx);
  const clean = store ? (await ctx.s.scrubFor(ctx.chatId, args.trim() === '' ? '/hoca' : args.trim(), ctx.selfRoles)).text : null;
  await ctx.db.openEscalation(ctx.chatId, ctx.messageRowId, 'human_requested', clean);
  if (ctx.chatKind === 'private') {
    await say(ctx, await privateEscalationText(ctx), { purpose: 'escalation', escalated: true, guards: ['human_requested'] });
    return;
  }
  const handle = await escalationHandle(ctx, subject);
  await say(ctx, texts.hocaGroup(handle), { purpose: 'escalation', escalated: true, guards: ['human_requested'], replyTo: ctx.message?.message_id ?? null });
}

async function advisorSla(ctx: Ctx): Promise<number> {
  const v = (await ctx.s.settings()).advisor_sla_hours;
  return typeof v === 'number' ? v : 4;
}
