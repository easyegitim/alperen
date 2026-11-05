// Adımlı analiz ilerlemesi (UI spec §3). Saf: adımlar gerçek işe bağlıdır; değer tekdüze artar, bitmeden 100 olmaz.
export const PROGRESS_STAGES = ["landmarks", "ratios", "prepare", "observe", "score"] as const;
export type ProgressStage = (typeof PROGRESS_STAGES)[number];
export type ProgressState = { done: ProgressStage[]; active: ProgressStage | null; startedAt: number; finished: boolean };

/** Gözlem adımında üstel yaklaşma zaman sabiti (ms). */
export const OBSERVE_TAU_MS = 12_000;
/** İlk üç adımın toplam payı ve gözlem adımının üst sınırı (%). */
const PRE_SHARE = 40;
const OBSERVE_SHARE = 50;

const nextOpen = (done: readonly ProgressStage[]): ProgressStage | null => PROGRESS_STAGES.find((s) => !done.includes(s)) ?? null;

export function startProgress(now: number): ProgressState {
  return { done: [], active: "landmarks", startedAt: now, finished: false };
}

/** Adımı tamamlar; etkin adım sıradaki tamamlanmamış adım olur. Zaten tamamsa durum aynı kalır. */
export function markDone(s: ProgressState, stage: ProgressStage): ProgressState {
  if (s.done.includes(stage)) return s;
  const done = PROGRESS_STAGES.filter((x) => x === stage || s.done.includes(x));
  return { ...s, done, active: nextOpen(done) };
}

/** Tüm adımlar tamam ve yanıt geldi. */
export function finishProgress(s: ProgressState): ProgressState {
  return { ...s, done: [...PROGRESS_STAGES], active: null, finished: true };
}

/**
 * 0–100. İlk üç adım 0–40'ı paylaşır; gözlem sürerken 40 + 50·(1 − e^(−t/12 sn)) (t: başlangıçtan beri);
 * gözlem bitince 90, skor bitince 95; yalnız finished iken 100.
 */
export function progressValue(s: ProgressState, now: number): number {
  if (s.finished) return 100;
  if (s.done.includes("score")) return 95;
  if (s.done.includes("observe")) return 90;
  const pre = (["landmarks", "ratios", "prepare"] as const).filter((x) => s.done.includes(x)).length;
  const base = (pre / 3) * PRE_SHARE;
  if (s.active === "observe") {
    const t = Math.max(0, now - s.startedAt);
    return Math.max(base, PRE_SHARE + OBSERVE_SHARE * (1 - Math.exp(-t / OBSERVE_TAU_MS)));
  }
  return base;
}
