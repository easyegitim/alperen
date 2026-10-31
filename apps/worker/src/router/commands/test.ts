/** /test — teşhis (ilk kez) ya da 10 soruluk pratik seti. */
import type { Ctx } from '../context.ts';
import { startDiagnostic } from '../flows/diagnostic.ts';
import { startPractice } from '../flows/practice.ts';

export async function run(ctx: Ctx): Promise<void> {
  const eid = ctx.identity.enrollment_id;
  if (eid === null) return;
  const status = await ctx.db.diagnosticStatus(eid);
  if (status === 'finished') await startPractice(ctx);
  else await startDiagnostic(ctx);
}
