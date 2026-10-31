/** Kota akışı (§5.4): öğrenci `consume_quota('message')`, personel `consume_staff_quota`; dolunca LLM yok. */
import type { QuotaResult } from '../../data/repo.ts';
import { texts } from '../../texts.ts';
import type { Ctx } from '../context.ts';

export type QuotaOutcome = { ok: true; q: QuotaResult | null } | { ok: false };

export async function consumeMessageQuota(ctx: Ctx, staff: boolean): Promise<QuotaOutcome> {
  if (ctx.s.cfg.quotaBypass.has(ctx.actor.id)) return { ok: true, q: null };
  const q = staff ? await ctx.db.consumeStaffQuota(ctx.chatId, ctx.actor.id, 'message') : await ctx.db.consumeQuota('message');
  if (q.allowed) return { ok: true, q };
  await ctx.s.reply({
    chatId: ctx.chatId,
    db: ctx.db,
    purpose: 'quota',
    texts: [staff ? texts.staffQuotaFull : texts.quotaFull(q.daily_limit)],
    quota: { used: q.used, limit: q.daily_limit },
    guards: ['quota'],
    inMessageId: ctx.messageRowId,
    replyTo: ctx.chatKind === 'private' ? null : (ctx.message?.message_id ?? null),
  });
  return { ok: false };
}

/** 5 kala günde bir kez uyarı metni (consume_quota `warn`). */
export function warnText(q: QuotaResult | null): string | null {
  return q !== null && q.warn ? texts.quotaWarn(q.remaining) : null;
}
