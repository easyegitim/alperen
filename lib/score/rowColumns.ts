// Tek analiz select listesi (UI spec §1.2, engine spec §8, sözleşme C8). engine_version ve signals migration 0009'la
// gelir; 0009 henüz uygulanmamış bir ortamda okumalar selectAnalysisRows ile eski listeye düşer (eski davranış).
export const ANALYSIS_ROW_COLUMNS =
  "id, status, created_at, face_shape, overall, potential, subscores, gains, observations, geometry, calibration_version, prompt_version, engine_version, signals" as const;

/** Migration 0009 öncesi sütunlar (prompt_version 0001'den beri var). */
export const LEGACY_ANALYSIS_ROW_COLUMNS =
  "id, status, created_at, face_shape, overall, potential, subscores, gains, observations, geometry, calibration_version, prompt_version" as const;

/**
 * Sütun listesi çalışma anında seçildiği için satır tipi `unknown`; çağıran, önceki gibi present.ts AnalysisRow'a
 * daraltır (engine_version / signals orada isteğe bağlıdır: undefined = eski satır).
 */
export type AnalysisRowsResult = { data: unknown; error: { code?: string } | null };

/** PostgREST/Postgres "sütun yok" kodları: migration 0009 bu ortamda henüz uygulanmamış. */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"]);

export function isMissingColumnError(e: { code?: string } | null | undefined): boolean {
  return Boolean(e?.code && MISSING_COLUMN_CODES.has(e.code));
}

/**
 * Sorguyu önce ANALYSIS_ROW_COLUMNS ile çalıştırır; yalnız "sütun yok" hatasında LEGACY_ANALYSIS_ROW_COLUMNS ile bir kez
 * yeniden dener (reportsStore.loadAnalysis ile aynı desen). Diğer hatalar olduğu gibi döner. Saf; birim testi var.
 */
export async function selectAnalysisRows(run: (columns: string) => PromiseLike<AnalysisRowsResult>): Promise<AnalysisRowsResult> {
  const full = await run(ANALYSIS_ROW_COLUMNS);
  if (!isMissingColumnError(full.error)) return full;
  return run(LEGACY_ANALYSIS_ROW_COLUMNS);
}

/**
 * hybrid.v2 satırı (migration 0010; CONTRACTS_V2.md §5). `runs` (çalıştırma başına ham vektörler) ve `ai_usage`
 * istemci yoluna seçilmez; rapor coach_reports'tan ayrı okunur (present.ts AnalysisRowV2.report).
 */
export const ANALYSIS_ROW_COLUMNS_V2 =
  `${ANALYSIS_ROW_COLUMNS}, device_result, score_range, percentile, sections_ready, set_key` as const;
