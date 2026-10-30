/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/figure-render-report.schema.json */

export type Uuid = string;

/**
 * Şekil denetim raporu (zincir vision_check): PNG + stem_values karşılaştırması {matches_stem, mismatches, notes}; isteğe bağlı olarak render adımının boyut/durum özeti. mismatch → attempts+1 ve 'kodu düzelt' ile yeniden üretim.
 */
export interface FigureRenderReport {
  schema_version?: "1.0";
  figure_id?: Uuid;
  /**
   * Şekil soru kökündeki değerlerle uyuşuyor mu
   */
  matches_stem: boolean;
  /**
   * figures.vision_status karşılığı; matches_stem ile tutarlı olmalı
   */
  status?: "match" | "mismatch";
  /**
   * @maxItems 20
   */
  mismatches: (string | Mismatch)[];
  notes?: string | null;
  render?: Render;
}
export interface Mismatch {
  /**
   * stem_values anahtarı ya da şekil öğesi
   */
  field: string;
  expected?: number | string | null;
  observed?: number | string | null;
  note?: string;
}
export interface Render {
  status: "ok" | "failed" | "size_mismatch" | "blank" | "skipped";
  tool?: "matplotlib" | "svg" | "tikz" | "vega-lite" | "schemdraw" | "rdkit" | "graphviz" | "latex" | "template";
  width_px?: number;
  height_px?: number;
  bytes?: number;
  pixel_variance?: number;
  duration_ms?: number;
  log?: string;
}
