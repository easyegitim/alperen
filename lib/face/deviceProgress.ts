// Ödeme öncesi yükleme ekranı (KB P#5, PLAN 1e): adımlar GERÇEK cihaz işine bağlıdır; son satır "Analizin tamamlandı"
// (cihazdaki analiz gerçekten bitmiştir). Saf; birim testi var. Hiçbir adım bir LLM çağrısı değildir.
export const DEVICE_STEPS = ["landmarks", "ratios", "faceShape", "views", "save"] as const;
export type DeviceStep = (typeof DEVICE_STEPS)[number];

export type DeviceProgress = { done: DeviceStep[]; active: DeviceStep | null; finished: boolean; startedAt: number };

const nextOpen = (done: readonly DeviceStep[]): DeviceStep | null => DEVICE_STEPS.find((s) => !done.includes(s)) ?? null;

export function startDeviceProgress(now: number): DeviceProgress {
  return { done: [], active: "landmarks", finished: false, startedAt: now };
}

export function markDeviceStep(s: DeviceProgress, step: DeviceStep): DeviceProgress {
  if (s.done.includes(step)) return s;
  const done = DEVICE_STEPS.filter((x) => x === step || s.done.includes(x));
  return { ...s, done, active: nextOpen(done) };
}

export function finishDeviceProgress(s: DeviceProgress): DeviceProgress {
  return { ...s, done: [...DEVICE_STEPS], active: null, finished: true };
}

/** 0–100: tamamlanan adım payı; yalnız finished iken 100. */
export function deviceProgressValue(s: DeviceProgress): number {
  if (s.finished) return 100;
  return Math.min(95, Math.round((s.done.length / DEVICE_STEPS.length) * 100));
}

/** Her adım en az bu kadar görünür (ms): gerçek iş daha hızlıysa kullanıcı adımı okuyabilsin diye; daha yavaşsa beklenir. */
export const DEVICE_STEP_MIN_MS = 350;
