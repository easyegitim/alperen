// Kart kart açılış (KB P#23, Ç16): sunucunun sections_ready listesi büyüdükçe kartlar sırayla açılır.
// Saf: zamanlama ve sıra burada; DOM yok (RevealSequence.tsx kullanır; tests/unit/reveal.test.ts).
import { SECTION_KEYS, type AnalysisStage, type SectionKey } from "@/lib/score/contract";

/** Kart açılış sırası = SECTION_KEYS sırası; "device" ödeme öncesi zaten açıktır. */
export const REVEAL_ORDER: readonly SectionKey[] = SECTION_KEYS;

/** Ardışık kartlar arası gecikme (ms); azaltılmış harekette 0. */
export const REVEAL_STAGGER_MS = 420;

/**
 * Açılacak kartlar, açılış sırasıyla: sunucu listesinde olan VE daha önce açılmamış olanlar. Sunucu listesinin
 * sırasına değil REVEAL_ORDER'a uyulur; listede olmayan anahtar açılmaz (yarım değer gösterilmez).
 */
export function nextReveals(ready: readonly SectionKey[], revealed: readonly SectionKey[]): SectionKey[] {
  const readySet = new Set(ready);
  const done = new Set(revealed);
  return REVEAL_ORDER.filter((k) => readySet.has(k) && !done.has(k));
}

/** Tamamlanan analizde listede eksik kalan bölüm de açılır: artık beklenecek bir şey yok (boş kart "yok" der). */
export function effectiveReady(stage: AnalysisStage, ready: readonly SectionKey[]): SectionKey[] {
  if (stage === "completed") return [...REVEAL_ORDER];
  const set = new Set(ready);
  return REVEAL_ORDER.filter((k) => set.has(k));
}

/** Henüz açılmamış kartlar hâlâ bekleniyor mu (ilerleme göstergesi için)? */
export function isRevealPending(stage: AnalysisStage, revealed: readonly SectionKey[]): boolean {
  if (stage === "failed" || stage === "device_only") return false;
  return revealed.length < REVEAL_ORDER.length;
}

/** Yoklama aralığı (ms): sıradayken 3 sn, çalışırken 2 sn; tamamlanınca/başarısızlıkta durur. */
export function pollIntervalMs(stage: AnalysisStage): number | null {
  if (stage === "queued") return 3000;
  if (stage === "running") return 2000;
  return null;
}
