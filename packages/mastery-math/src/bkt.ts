/**
 * Öğrenmen ustalık matematiği — Bayesian Knowledge Tracing (BLUEPRINT §3.7, ADR-0001).
 *
 * Tek kaynak: aynı formüller `sql/bkt.sql` (yazan tek yer `apply_observation`) ve
 * `python/ogrenmen_mastery/bkt.py` içinde birebir uygulanır; `fixtures/bkt-vectors.json`
 * üç dilde 1e-9 toleransla aynı sonucu verir.
 */

/** Ustalık değerinin alt sınırı (kırpma). */
export const P_MIN = 0.01;
/** Ustalık değerinin üst sınırı (kırpma). */
export const P_MAX = 0.99;
/** Sürekli gözlemde tek gözlemin profili en fazla ne kadar çekebileceği: w = 0.30·c. */
export const BLEND_RATE = 0.3;
/** Sürekli gözlemde güven boşsa kullanılan değer. */
export const DEFAULT_CONFIDENCE = 0.8;
/** Sayısal (numeric) sorularda gözleme yazılan tahmin olasılığı (`guess_override`). */
export const NUMERIC_GUESS = 0.05;
/** Ön koşul çıkarım gözleminin ağırlığı (`apply_observation` 0.5 yazar). */
export const INFERRED_WEIGHT = 0.5;

/** Değeri [P_MIN, P_MAX] aralığına kırpar (SQL: least(0.99, greatest(0.01, x))). */
export function clip(x: number): number {
  return Math.min(P_MAX, Math.max(P_MIN, x));
}

function assertFinite(name: string, value: number): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new RangeError(`OGR-MAST-003 ${name} sonlu bir sayı olmalı: ${String(value)}`);
  }
}

/**
 * İkili gözlem adımı.
 * Doğruysa p_obs = p(1−s) / (p(1−s) + (1−p)g), yanlışsa p_obs = ps / (ps + (1−p)(1−g));
 * sonra p_new = p_obs + (1−p_obs)·t, [0.01, 0.99] aralığına kırpılır.
 *
 * Payda sıfırsa SQL NULL döner ve `mastery.p not null` kısıtı yazımı düşürür;
 * burada aynı durum `RangeError` ile açıkça reddedilir.
 */
export function bktStep(p: number, correct: boolean, g: number, s: number, t: number): number {
  assertFinite('p', p);
  assertFinite('g', g);
  assertFinite('s', s);
  assertFinite('t', t);
  const num = correct ? p * (1 - s) : p * s;
  const den = correct ? p * (1 - s) + (1 - p) * g : p * s + (1 - p) * (1 - g);
  if (den === 0) {
    throw new RangeError('OGR-MAST-003 BKT paydası sıfır (p, g, s parametrelerini denetle)');
  }
  const pObs = num / den;
  return clip(pObs + (1 - pObs) * t);
}

/**
 * Sürekli gözlem (ders analizi, eğitmen tahmini): p + w·(m − p), w = 0.30·c.
 * c boşsa 0.8 kabul edilir; öğrenme geçişi uygulanmaz; sonuç kırpılır.
 */
export function blendStep(p: number, m: number, c?: number | null): number {
  assertFinite('p', p);
  assertFinite('m', m);
  const conf = c ?? DEFAULT_CONFIDENCE;
  assertFinite('c', conf);
  return clip(p + BLEND_RATE * conf * (m - p));
}

/** Çıkarım gözlemi için yumuşatılmış tahmin olasılığı: g' = g + (1 − g)(1 − w). */
export function inferredGuess(g: number, w: number): number {
  assertFinite('g', g);
  assertFinite('w', w);
  return g + (1 - g) * (1 - w);
}

/** `observations.kind` değerleri (BLUEPRINT §3.3). */
export type ObservationKind =
  | 'diagnostic'
  | 'practice'
  | 'test'
  | 'lesson'
  | 'chat_question'
  | 'chat_misconception'
  | 'instructor'
  | 'inferred'
  | 'resolution';

/** `apply_observation`'ın okuduğu gözlem alanları. */
export interface ObservationInput {
  kind: ObservationKind;
  /** İkili gözlemde 0/1, sürekli gözlemde 0–1 ustalık tahmini; sohbet gözlemlerinde null. */
  value?: number | null;
  /** Gözlem ağırlığı (varsayılan 1.0; inferred satırlarında 0.5). */
  weight?: number | null;
  /** Sürekli gözlemde analiz güveni (boşsa 0.8). */
  confidence?: number | null;
  /** Gözleme özel g; numeric sorularda 0.05, mcq'da null → `skills.p_guess`. */
  guess_override?: number | null;
  /** İlk deneme dışındaki ikili gözlemler ustalık sayacını artırmaz. */
  counts_for_mastery?: boolean | null;
}

/** Kazanımın BKT parametreleri (`skills` satırı). */
export interface SkillParams {
  p_guess: number;
  p_slip: number;
  p_learn: number;
}

/** Tek gözlemin ustalığa etkisi; `mastery_history` satırının karşılığı. */
export interface ObservationStep {
  /** Gözlemden sonraki p. */
  p: number;
  /** `evidence_count` artışı (0 ya da 1). */
  evidenceIncrement: 0 | 1;
  /** `mastery_history.method`; sohbet gözlemlerinde null (geçmiş satırı yazılmaz). */
  method: 'bkt' | 'blend' | 'inferred' | null;
  /** `mastery_history.params` ile aynı anahtarlar. */
  params: Record<string, number | null>;
}

const BINARY_KINDS: ReadonlySet<ObservationKind> = new Set(['diagnostic', 'practice', 'test', 'resolution']);
const CONTINUOUS_KINDS: ReadonlySet<ObservationKind> = new Set(['lesson', 'instructor']);
const CHAT_KINDS: ReadonlySet<ObservationKind> = new Set(['chat_question', 'chat_misconception']);

/**
 * `public.apply_observation` gövdesinin türe göre dallanmasının saf karşılığı
 * (Worker FakeDb ve Python JsonlDb aynı kuralı uygular). `p0` mevcut ustalık
 * (satır yoksa `skills.p_init`).
 */
export function observationStep(p0: number, obs: ObservationInput, skill: SkillParams): ObservationStep {
  if (CHAT_KINDS.has(obs.kind)) {
    return { p: p0, evidenceIncrement: 0, method: null, params: {} };
  }
  if (BINARY_KINDS.has(obs.kind)) {
    const g = obs.guess_override ?? skill.p_guess;
    const correct = obs.value !== null && obs.value !== undefined && obs.value >= 0.5;
    return {
      p: bktStep(p0, correct, g, skill.p_slip, skill.p_learn),
      evidenceIncrement: obs.counts_for_mastery === false ? 0 : 1,
      method: 'bkt',
      params: {
        g,
        s: skill.p_slip,
        t: skill.p_learn,
        w: obs.weight ?? 1,
        guess_override: obs.guess_override ?? null,
      },
    };
  }
  if (CONTINUOUS_KINDS.has(obs.kind)) {
    if (obs.value === null || obs.value === undefined) {
      throw new RangeError('OGR-MAST-003 sürekli gözlemde value zorunlu');
    }
    const conf = obs.confidence ?? DEFAULT_CONFIDENCE;
    return {
      p: blendStep(p0, obs.value, obs.confidence),
      evidenceIncrement: 1,
      method: 'blend',
      params: { w: BLEND_RATE * conf, m: obs.value },
    };
  }
  if (obs.kind === 'inferred') {
    const w = obs.weight ?? 1;
    const g = inferredGuess(obs.guess_override ?? skill.p_guess, w);
    return {
      p: bktStep(p0, false, g, skill.p_slip, skill.p_learn),
      evidenceIncrement: 0,
      method: 'inferred',
      params: { g_eff: g, s: skill.p_slip, t: skill.p_learn, w },
    };
  }
  throw new RangeError(`OGR-MAST-001 bilinmeyen gözlem türü ${String(obs.kind)}`);
}
