// Eğitmen inceleme kuyruğunun saf yardımcıları: doğrulama merdiveni özeti kelimeyle (test/documents-request.test.ts).
export const LADDER: ReadonlyArray<{ step: string; label: string }> = [
  { step: 'schema', label: 'Biçim' },
  { step: 'sympy', label: 'Çözümler (SymPy)' },
  { step: 'figures', label: 'Şekiller' },
  { step: 'duplicates', label: 'Tekrarlar' },
  { step: 'personalization', label: 'Kişiselleştirme' },
];

export type StepTone = 'pass' | 'fail' | 'neutral';
export interface StepLine {
  step: string;
  label: string;
  word: string;
  tone: StepTone;
  /** Varsa modelin / doğrulayıcının kısa notu (ilk 160 karakter). */
  note: string | null;
}

const WORDS: Record<string, { word: string; tone: StepTone }> = {
  pass: { word: 'geçti', tone: 'pass' },
  fail: { word: 'kaldı', tone: 'fail' },
  skipped: { word: 'atlandı', tone: 'neutral' },
  pending: { word: 'bekliyor', tone: 'neutral' },
};

function noteOf(v: Record<string, unknown>): string | null {
  for (const k of ['summary', 'note', 'reason', 'message']) {
    const x = v[k];
    if (typeof x === 'string' && x.trim()) return x.trim().slice(0, 160);
  }
  return null;
}

/** verification jsonb → beş basamak (kelimeyle) + yeniden üretilen blok sayısı. */
export function verificationLines(verification: unknown): { steps: StepLine[]; regenerated: number } {
  const v = verification && typeof verification === 'object' ? (verification as Record<string, unknown>) : {};
  const steps = LADDER.map(({ step, label }) => {
    const raw = v[step];
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const w = WORDS[String(obj.status ?? 'pending')] ?? WORDS.pending!;
    return { step, label, word: w.word, tone: w.tone, note: noteOf(obj) };
  });
  const regen = Array.isArray(v.regen) ? v.regen : [];
  return { steps, regenerated: new Set(regen.map((r) => String((r as { block_id?: unknown })?.block_id ?? ''))).size };
}

/** İnceleme kararı onaya hazır mı: kalan basamak varsa uyarı satırı (karar yine eğitmenindir). */
export function reviewWarning(steps: StepLine[]): string | null {
  const failed = steps.filter((s) => s.tone === 'fail').map((s) => s.label);
  return failed.length > 0 ? `Kontrolden geçmeyen: ${failed.join(', ')}` : null;
}

const KINDS: Record<string, string> = { notes: 'Not', mock_exam: 'Deneme', question_set: 'Soru seti', report: 'Rapor' };
export const kindWord = (kind: string): string => KINDS[kind] ?? 'Belge';
