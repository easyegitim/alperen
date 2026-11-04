// Kart kart açılış (KB P#23, Ç16; CONTRACTS_V2 §2.3/4): sunucunun sectionsReady listesi büyüdükçe kartlar sırayla açılır.
// Web components/analysis/reveal.ts ile aynı kurallar (mobil @/components/* içe aktaramaz; saf kopya, birim testli).
import { RESULT_FOCUS_BELOW } from "@/lib/config/scoring";
import { SECTION_KEYS, type AnalysisStage, type SectionKey } from "@/lib/score/contract";

/** Kart açılış sırası = SECTION_KEYS sırası; "device" ödeme öncesi zaten açıktır. */
export const REVEAL_ORDER: readonly SectionKey[] = SECTION_KEYS;
/** Ardışık kartlar arası gecikme (ms); azaltılmış harekette 0. */
export const REVEAL_STAGGER_MS = 420;

/** Açılacak kartlar, açılış sırasıyla: sunucu listesinde olan VE daha önce açılmamış olanlar. Listede olmayan anahtar açılmaz. */
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

/** Yoklama aralığı (ms): sıradayken 3 sn, çalışırken 2 sn; tamamlanınca/başarısızlıkta durur (web ile aynı). */
export function pollIntervalMs(stage: AnalysisStage): number | null {
  if (stage === "queued") return 3000;
  if (stage === "running") return 2000;
  return null;
}

/** fail_stuck_jobs 2 saatte takılı sayar; istemci en çok 3 saat yoklar. */
export const MAX_POLL_MS = 3 * 3_600_000;

/** Kart sırası (KB §4.8): skor 4,0'ın altındaysa gelişim alanları önce. potential/explanations ayrı kart değildir. */
export function cardOrder(lowScore: boolean): SectionKey[] {
  return lowScore ? ["improveFirst", "subscores", "overall", "faceShape", "device", "report"] : ["overall", "subscores", "improveFirst", "faceShape", "device", "report"];
}

export function isLowScore(overall: number | null): boolean {
  return overall !== null && overall < RESULT_FOCUS_BELOW;
}

/** Kaç kart açılabilir durumda ("{done} / {total} kart hazır"). */
export function revealProgress(stage: AnalysisStage, cards: readonly SectionKey[], ready: readonly SectionKey[]): { done: number; total: number } {
  const set = new Set(effectiveReady(stage, ready));
  return { done: cards.filter((k) => set.has(k)).length, total: cards.length };
}

/** Bölüm açık mı: tamamlandıysa hepsi; çalışırken yalnız sunucu listesindekiler. */
export function sectionReady(stage: AnalysisStage, ready: readonly SectionKey[], key: SectionKey): boolean {
  return stage === "completed" || ready.includes(key);
}
