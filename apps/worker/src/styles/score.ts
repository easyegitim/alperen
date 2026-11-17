/**
 * Tarz öncelik skoru (docs/PLAN-v2.md §11): `skor = 0.5·sıklık + 0.3·güncellik + 0.2·müfredat uyumu`. SQL karşılığı
 * `app.refresh_style_scores` (0037) tek yazandır; bu saf karşılık testlerde ve worker günlüğünde kullanılır, canlı test
 * ikisinin aynı sonucu verdiğini denetler.
 *   sıklık    = tarzın sorulduğu yıl sayısı / arşivdeki yıl sayısı
 *   güncellik = 0.5 ^ ((arşivin son yılı − tarzın son yılı) / 2)   (hiç sorulmadıysa 0)
 *   uyum      = verilir (izlence payı; kazanımsız tarz 0,5, izlence yoksa kazanımlı tarz 1)
 * Değerler 4 basamağa yuvarlanır (numeric(5,4)).
 */

export const SCORE_WEIGHTS = { frequency: 0.5, recency: 0.3, alignment: 0.2 } as const;

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

export interface StyleScoreInput {
  /** Tarzın sorulduğu yıllar. */
  yearsHit: readonly number[];
  /** Dersin arşivindeki bütün yıllar. */
  archiveYears: readonly number[];
  /** 0..1 müfredat uyumu. */
  alignment: number;
}

export interface StyleScore {
  frequency: number;
  recency: number;
  alignment: number;
  score: number;
}

export function styleScore(i: StyleScoreInput): StyleScore {
  const archive = new Set(i.archiveYears);
  const hit = new Set(i.yearsHit);
  const frequency = archive.size === 0 ? 0 : r4(hit.size / archive.size);
  const lastArchive = archive.size ? Math.max(...archive) : null;
  const lastHit = hit.size ? Math.max(...hit) : null;
  const recency = lastArchive === null || lastHit === null ? 0 : r4(0.5 ** ((lastArchive - lastHit) / 2));
  const alignment = r4(Math.min(1, Math.max(0, i.alignment)));
  const score = r4(SCORE_WEIGHTS.frequency * frequency + SCORE_WEIGHTS.recency * recency + SCORE_WEIGHTS.alignment * alignment);
  return { frequency, recency, alignment, score };
}

/** Öğrenciye yüzde yerine sıklık kelime bandı (SQL app.style_frequency_band ile aynı eşikler). */
export function frequencyBand(frequency: number | null): string | null {
  if (frequency === null || frequency <= 0) return null;
  if (frequency >= 0.6) return 'sık soruluyor';
  if (frequency >= 0.3) return 'ara sıra soruluyor';
  return 'seyrek soruluyor';
}
