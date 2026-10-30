/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/transcript.schema.json */

/**
 * HH:MM:SS
 */
export type Ts = string;
export type Speaker = "ÖĞRENCİ" | "EĞİTMEN";

/**
 * Ders transkripti (transcribe/diarize sahteleri ve transcripts/<id>.jsonl): konuşmacı etiketli, isimsiz bölümler. Tek bölüm transcript#/$defs/segment ile doğrulanır.
 */
export interface Transcript {
  /**
   * @minItems 1
   */
  segments: Segment[];
}
export interface Segment {
  t: Ts;
  t_end?: Ts;
  speaker: Speaker;
  text: string;
}
