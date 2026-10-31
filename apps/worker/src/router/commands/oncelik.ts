/**
 * /oncelik — tek RPC `priority_plan_for_enrollment` (bot_runtime'ın `courses` yetkisi yok). Başlık her
 * zaman "Sıklık analizine göre öncelikler"; "tahmin/çıkacak/kesin/garanti" kelimeleri metinde yok. LLM yok.
 */
import { texts, kindLabel } from '../../texts.ts';
import { say, type Ctx } from '../context.ts';

export async function run(ctx: Ctx): Promise<void> {
  const eid = ctx.identity.enrollment_id;
  const plan = eid === null ? null : await ctx.db.priorityPlanForEnrollment(eid);
  if (plan === null || plan.rows.length === 0) {
    await say(ctx, texts.oncelikNone);
    return;
  }
  const rows = plan.rows.slice(0, 5).map((r) => texts.oncelikRow(r.rank, r.topic, kindLabel(r.kind), r.years, plan.years_total, r.points_text, r.evidence_count));
  const first = [texts.oncelikHead(plan.course_code, plan.period, plan.years_total), ...rows.slice(0, 3)].join('\n');
  const second = [...rows.slice(3), texts.oncelikNote].join('\n');
  await say(ctx, [first, second]);
}
