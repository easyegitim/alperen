// Çoklu açı çekim akışının saf durumu (KB P#4; CONTRACTS_V2 §2.1; web components/camera/CaptureScreen.tsx ile aynı
// kurallar): ön (zorunlu, otomatik çekim) → yan profil (zorunlu, iki profilden biri) → isteğe bağlı 45°×2 / diğer
// profil / saç çizgisi → özet. Görsel içermez; birim testli.
import { eulerFromMatrix } from "@/lib/face/pose";
import type { FrameAnalysis } from "@/lib/face/types";
import { OPTIONAL_VIEWS, PROFILE_VIEWS, VIEWS, classifyView, type ViewClass, type ViewKey } from "@/lib/face/views";

export type CaptureSet<T> = Partial<Record<ViewKey, T>>;

export type FlowStep = { kind: "capture"; view: ViewKey; required: boolean } | { kind: "summary" };

export const FRONT_STEP: FlowStep = { kind: "capture", view: "front", required: true };
export const PROFILE_STEP: FlowStep = { kind: "capture", view: "profile_left", required: true };
export const SUMMARY_STEP: FlowStep = { kind: "summary" };

export const isProfileView = (v: ViewKey): boolean => (PROFILE_VIEWS as readonly ViewKey[]).includes(v);

/** Zorunlu yan profil: iki profilden hangisi çekildiyse (KB P#4: "zorunlu yan profil iki profilden biri sayılır"). */
export function hasProfile<T>(set: CaptureSet<T>): boolean {
  return PROFILE_VIEWS.some((v) => set[v] !== undefined);
}

/** Sıradaki adım: ön yoksa ön; profil yoksa profil; aksi hâlde özet. */
export function nextStep<T>(set: CaptureSet<T>): FlowStep {
  if (!set.front) return FRONT_STEP;
  if (!hasProfile(set)) return PROFILE_STEP;
  return SUMMARY_STEP;
}

/** Açıya yerleştirir; aynı açı yeniden çekildiyse eskisi döner (çağıran geçici dosyayı siler). */
export function placeViews<T extends { view: ViewKey }>(set: CaptureSet<T>, items: readonly T[]): { set: CaptureSet<T>; replaced: T[] } {
  const next: CaptureSet<T> = { ...set };
  const replaced: T[] = [];
  for (const r of items) {
    const prev = next[r.view];
    if (prev) replaced.push(prev);
    next[r.view] = r;
  }
  return { set: next, replaced };
}

export function removeView<T>(set: CaptureSet<T>, view: ViewKey): CaptureSet<T> {
  const next = { ...set };
  delete next[view];
  return next;
}

/** Çekilen açılar VIEWS sırasıyla (ön her zaman ilk). */
export function orderedViews<T>(set: CaptureSet<T>): ViewKey[] {
  return VIEWS.map((v) => v.key).filter((k) => set[k] !== undefined);
}

/** Özette eklenebilecek açılar: çekilmemiş profiller ve isteğe bağlılar. */
export function addableViews<T>(set: CaptureSet<T>): ViewKey[] {
  return [...PROFILE_VIEWS, ...OPTIONAL_VIEWS].filter((v) => set[v] === undefined);
}

/** Adım etiketi: ön 1/2, zorunlu profil 2/2, isteğe bağlı açı sayısız. */
export function stepIndex(step: FlowStep): { current: number; total: number } | null {
  if (step.kind !== "capture") return null;
  if (step.view === "front") return { current: 1, total: 2 };
  if (step.required && isProfileView(step.view)) return { current: 2, total: 2 };
  return null;
}

/** Çerçevenin yaw'ından görünüm sınıfı; yüz ağı/matris yoksa "invalid". */
export function classifyFrame(frame: Pick<FrameAnalysis, "faces" | "landmarks" | "matrix">): ViewClass {
  if (frame.faces !== 1 || !frame.landmarks || !frame.matrix) return { view: null, reason: "invalid" };
  return classifyView(eulerFromMatrix(frame.matrix).yaw);
}

/**
 * Profil adımında yüz ağı okunabildiyse hangi yanak olduğu yaw'dan alınır (sol/sağ etiketi); doğrulama değildir
 * (KB P#4 Claude notu: ödeme öncesi "gerçekten profil mi" kontrol edilmez).
 */
export function relabelProfile(target: ViewKey, cls: ViewClass): ViewKey {
  if (!isProfileView(target)) return target;
  if (cls.view === "profile_left" || cls.view === "profile_right") return cls.view;
  return target;
}

/**
 * Galeri çoklu seçimi (KB R1-E5): her dosya yaw'a göre açıya yerleşir; sınıflanamayan ya da dolu açıya düşen dosya
 * bu adımın açısına gider (o da doluysa atlanır). taken kümesi çağrı sırasında güncellenir.
 */
export function galleryTarget(cls: ViewClass, taken: ReadonlySet<ViewKey>, current: ViewKey): ViewKey | null {
  let target: ViewKey | null = cls.view;
  if (target === null || taken.has(target)) target = taken.has(current) ? null : current;
  return target;
}

/** "Analizi başlat" koşulu: ön + geometri + en az bir profil (KB P#4); kota hatasında pasif. */
export function canStartDevice<T>(set: CaptureSet<T>, geometryReady: boolean, lastErrorCode?: string | null): boolean {
  return Boolean(set.front) && geometryReady && hasProfile(set) && lastErrorCode !== "QUOTA_EXCEEDED";
}
