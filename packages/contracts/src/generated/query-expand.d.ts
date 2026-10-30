/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/query-expand.schema.json */

/**
 * Kitap araştırma sorusunun 3–5 arama sorgusuna genişletilmesi (zincir query_expand).
 */
export interface QueryExpand {
  /**
   * @minItems 3
   * @maxItems 5
   */
  queries: string[];
}
