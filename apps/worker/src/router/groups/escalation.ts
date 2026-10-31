/**
 * Yükseltme hedefi (§5.8): sohbetteki branş eğitmeni (`chat_roles.mention_handle`, aynı branş;
 * `/hoca matematik` ile seçim), yoksa koordinatör; tanıtıcı yoksa "hocan".
 */
import { texts } from '../../texts.ts';
import type { Ctx } from '../context.ts';

export async function escalationHandle(ctx: Ctx, subject: string | null): Promise<string> {
  const staff = await ctx.db.chatStaff(ctx.chatId).catch(() => []);
  const want = subject?.toLocaleLowerCase('tr-TR') ?? null;
  const pick =
    (want === null ? undefined : staff.find((s) => s.role === 'instructor' && s.subject?.toLocaleLowerCase('tr-TR') === want)) ??
    staff.find((s) => s.role === 'instructor') ??
    staff.find((s) => s.role === 'coordinator');
  return pick?.mention_handle ?? texts.hocaFallbackHandle;
}
