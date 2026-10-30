/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/research-output.schema.json */

export type Uuid = string;
export type Probability = number;
export type DateTime = string;
export type Usd = number;

/**
 * Kitap araştırma çıktısı: her atıf Crossref'te doğrulanmış (verified) ya da DOI'siz kurumsal bağlantılı (no_doi); unresolved burada olamaz.
 */
export interface ResearchOutput {
  schema_version: "1.0";
  request_id: Uuid;
  query: string;
  /**
   * @minItems 3
   * @maxItems 5
   */
  expanded_queries: string[];
  /**
   * @minItems 1
   */
  synthesis: {
    text: string;
    /**
     * citations[].ordinal — her paragraf en az bir doğrulanmış kaynağa bağlı; pipeline eşleşmeyen paragrafı atar
     *
     * @minItems 1
     */
    cites: number[];
  }[];
  /**
   * Yalnız verified veya no_doi; unresolved burada OLAMAZ (enum)
   */
  citations: Citation[];
  matrix: {
    ordinal: number;
    method: string;
    sample: string;
    finding: string;
    limitation: string;
  }[];
  /**
   * Yalnız inceleme ekranı; öğrenciye gitmez
   */
  removed: {
    doi_or_title: string;
    reason: "crossref_unresolved" | "title_mismatch" | "no_doi_no_link" | "duplicate" | "off_topic";
  }[];
  bibtex: string;
  apa: string[];
  model: string;
  cost_usd: Usd;
}
export interface Citation {
  ordinal: number;
  doi?: string;
  title: string;
  authors: string;
  venue?: string | null;
  year: number;
  crossref_status: "verified" | "no_doi";
  title_similarity?: Probability;
  verified_at?: DateTime;
  oa_pdf_url?: string | null;
  /**
   * Tek cümle; kaynağın iddiasını aşmaz
   */
  tldr?: string | null;
  source?: "openalex" | "semantic_scholar" | "arxiv" | "crossref" | "manual";
}
