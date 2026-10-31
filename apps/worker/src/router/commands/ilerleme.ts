/** /ilerleme — kazanım başına: evidence_count ≥ 5 ise yüzde, değilse "henüz yeterli kanıt yok"; ≤ 6 satır, iki mesaj. */
import { formatPercent } from '../../telegram/format.ts';
import { texts } from '../../texts.ts';
import { say, type Ctx } from '../context.ts';

export async function runIlerleme(ctx: Ctx): Promise<void> {
  const eid = ctx.identity.enrollment_id;
  const rows = eid === null ? [] : await ctx.db.masteryView(eid);
  if (rows.length === 0) {
    await say(ctx, texts.progressEmpty);
    return;
  }
  const top = [...rows].sort((a, b) => Number(b.is_reliable) - Number(a.is_reliable) || b.evidence_count - a.evidence_count || a.skill_name.localeCompare(b.skill_name, 'tr')).slice(0, 6);
  const lines = top.map((r) => texts.progressLine(r.skill_name, r.is_reliable ? formatPercent(r.p) : texts.progressNoEvidence));
  const first = [texts.progressHead, ...lines.slice(0, 3)].join('\n');
  const rest = lines.slice(3);
  await say(ctx, rest.length === 0 ? [first] : [first, rest.join('\n')]);
}

export const run = runIlerleme;
