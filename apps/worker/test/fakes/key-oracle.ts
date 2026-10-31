/**
 * Sahte cevap anahtarı kapısı: dev-seed.json `secure.answer_keys` tablosunu okur. Canlıda bu bilgi
 * yalnız `grade_attempt` / `reveal_solution` SECURITY DEFINER gövdelerindedir; Worker kaynağı (src/)
 * anahtar alanını hiç anmaz, bu dosya yalnız test/dev girişindedir.
 */
import type { AnswerOracle } from '../../src/data/fake.ts';

interface KeyRow {
  question_id: string;
  correct_option: string | null;
  numeric_value: string | null;
  numeric_tolerance: number | null;
  solution: string;
}

/** app.numeric_equal eşleniği: a/b kesri, ondalık (virgül ya da nokta), tam sayı; ifade ayrıştırılmaz. */
export function parseNumeric(s: string): number | null {
  const t = s.replace(/\s+/g, '').replace(',', '.');
  const frac = /^(-?\d+)\/(-?\d+)$/.exec(t);
  if (frac) {
    const d = Number(frac[2]);
    return d === 0 ? null : Number(frac[1]) / d;
  }
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

export class SeedAnswerOracle implements AnswerOracle {
  private readonly keys = new Map<string, KeyRow>();
  constructor(seed: Record<string, unknown>) {
    for (const r of (seed['secure.answer_keys'] as KeyRow[] | undefined) ?? []) this.keys.set(r.question_id, r);
  }
  verdict(questionId: string, chosen: { key?: string; value?: string }): boolean | null {
    const k = this.keys.get(questionId);
    if (k === undefined) return null;
    if (chosen.key !== undefined && k.correct_option !== null) return chosen.key === k.correct_option;
    if (chosen.value !== undefined && k.numeric_value !== null) {
      const a = parseNumeric(chosen.value);
      const b = parseNumeric(k.numeric_value);
      return a !== null && b !== null && Math.abs(a - b) <= (k.numeric_tolerance ?? 0) + 1e-12;
    }
    return false;
  }
  solution(questionId: string): string | null {
    return this.keys.get(questionId)?.solution ?? null;
  }
  /** Testler için: bir sorunun doğru şıkkı (yalnız test kodu kullanır). */
  correctKey(questionId: string): string | null {
    return this.keys.get(questionId)?.correct_option ?? null;
  }
  drop(questionId: string): void {
    this.keys.delete(questionId);
  }
}
