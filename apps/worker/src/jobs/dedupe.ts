/**
 * İş tekilleştirme seçenekleri (bkz. `EnqueueOptions`). pg-boss `standard` kuyruğunda singletonKey yalnız
 * `singletonSeconds` ile birlikte etkilidir: aynı ad + anahtar + zaman dilimi için tek iş (pg-boss job_i4).
 */
import type { EnqueueOptions } from './types.js';

/** Öğrenci başına yenileme dilimi (sn): suggestions.refresh, dossier.render. */
export const REFRESH_DEBOUNCE_SEC = 15;
/** Gece zinciri dilimi (sn): 12 saat; 03:00 TRT = 00:00 UTC dilim başıdır, yeniden denemeler aynı dilime düşer. */
export const NIGHTLY_SLOT_SEC = 12 * 3600;

/**
 * Debounce: anahtar başına dilimde tek iş; dilim doluysa iş bir sonraki dilimin başına ertelenir, o da doluysa düşer
 * (ertelenmiş iş henüz başlamadığı için en yeni veriyi görür). Peş peşe etkinliklerde yinelenen Haiku çağrısı olmaz.
 */
export function debounced(key: string, seconds = REFRESH_DEBOUNCE_SEC): EnqueueOptions {
  return { singletonKey: key, singletonSeconds: seconds, debounce: true };
}

/** Dilim başına bir kez (ertelemesiz): gece zinciri; memory.compact yeniden denendiğinde zincir yinelenmez. */
export function oncePer(key: string, seconds = NIGHTLY_SLOT_SEC): EnqueueOptions {
  return { singletonKey: key, singletonSeconds: seconds };
}
