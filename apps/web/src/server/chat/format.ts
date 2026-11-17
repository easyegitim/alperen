/** Koç araçlarının çıktı biçimleri (saf). Ustalık kelime bandıyla ve kanıt sayısıyla söylenir (PLAN-v2 §6). */

export const MIN_EVIDENCE_FOR_BAND = 3;

export function bandOf(p: number, evidence: number): 'az kanıt' | 'zayıf' | 'orta' | 'iyi' {
  if (!Number.isFinite(evidence) || evidence < MIN_EVIDENCE_FOR_BAND) return 'az kanıt';
  if (p < 0.4) return 'zayıf';
  if (p < 0.7) return 'orta';
  return 'iyi';
}

export function evidenceWords(n: number): string {
  return `${Number.isFinite(n) ? n : 0} kanıt`;
}

/** İlk eşleşen kelimenin çevresinden ≤ 240 karakterlik kesit. */
export function snippet(text: string, words: readonly string[], max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const lower = flat.toLocaleLowerCase('tr');
  const hits = words.map((w) => lower.indexOf(w)).filter((i) => i >= 0);
  const at = hits.length > 0 ? Math.min(...hits) : 0;
  const start = Math.max(0, Math.min(at - 60, flat.length - max));
  const body = flat.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${body}${start + max < flat.length ? '…' : ''}`;
}

/**
 * Ret kategorisi → eğitmene gösterilen Türkçe etiket (ham İngilizce değer yalnız bildirimin payload'ında kalır).
 * Bilinmeyen ya da bildirilmemiş kategori "genel kural" olur.
 */
const REFUSAL_LABEL_TR: Record<string, string> = {
  bio: 'biyolojik güvenlik',
  cyber: 'güvenlik',
  frontier_llm: 'yapay zekâ kullanımı',
  reasoning_extraction: 'düşünme süreci',
  general_harms: 'genel kural',
};

export function refusalLabel(category: string | null | undefined): string {
  return (category && REFUSAL_LABEL_TR[category]) || 'genel kural';
}

/** Aynı sohbetten eğitmene en çok bu aralıkta bir yönlendirme gider (öğrenci ısrar etse de gelen kutusu dolmaz). */
export const ESCALATION_DEDUPE_MS = 24 * 60 * 60 * 1000;

/** Yönlendirme bildiriminin gövdesi (eğitmene; kategori Türkçe etiketle). */
export function escalationBody(input: { reason: 'refusal' | 'turn_meta'; category: string | null; note: string | null }): string {
  return input.reason === 'refusal'
    ? `Koç bir isteğe yanıt vermedi (konu: ${refusalLabel(input.category)}); öğrenci sana yönlendirildi.`
    : `Koç bu konuyu sana yönlendirdi${input.note ? `: ${input.note.slice(0, 400)}` : '.'}`;
}
