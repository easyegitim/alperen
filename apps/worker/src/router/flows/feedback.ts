/** Şık cevabı geri bildirimi (LLM yok): havuz metni → yanılgı metni → genel metin; ön koşul ipucu. */
import type { GradeResult } from '../../data/repo.ts';
import { texts } from '../../texts.ts';
import type { Ctx } from '../context.ts';

export async function feedbackText(ctx: Ctx, g: GradeResult): Promise<{ text: string; poolId: string | null }> {
  let body: string | null = null;
  let poolId: string | null = null;
  if (g.feedback_pool_id !== null) {
    // grade_attempt hangi havuz satırını seçtiyse o (§5.2: "feedback_pool_id varsa havuz metni").
    const pool = await ctx.db.poolById(g.feedback_pool_id).catch(() => null);
    if (pool) {
      body = pool.body;
      poolId = pool.id;
      await ctx.db.poolHit(pool.id).catch(() => undefined);
    }
  }
  let text: string;
  if (body !== null && /^[✓✕]/.test(body)) text = body;
  else {
    const reason = body ?? g.feedback_student ?? (g.is_correct ? texts.genericRight : texts.genericWrong);
    text = g.is_correct ? texts.correct(reason) : texts.wrong(reason);
  }
  if (g.is_correct === false && g.prereq_hint !== null) text += `\n${g.prereq_hint}.`;
  return { text, poolId };
}

/** Şık satırı: "A) `-11`  B) `-2`  C) `5`  D) `-5`" (şık metinleri gövdede, düğmeler A·B·C·D). */
export function optionsLine(options: ReadonlyArray<{ key: string; text: string }> | null): string {
  if (options === null || options.length === 0) return 'Cevabını sayı olarak yaz.';
  return options.map((o) => `${o.key}) ${o.text}`).join('  ');
}
