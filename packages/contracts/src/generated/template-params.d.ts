/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). Kaynak: schemas/template-params.schema.json */

export type Value =
  | (
      | Leaf
      | {
          [k: string]: Leaf;
        }
    )
  | undefined;
export type Leaf = Scalar | Scalar[];
export type Scalar = number | string | boolean | null;

/**
 * Parametrik şablon varyantının parametreleri (question-item.template ile aynı biçim: {id, params}); seed ile aynı varyant yeniden üretilir. Değerler: sayı, metin, mantıksal, null, bunların düz dizisi ya da bir düzey düz nesne (ör. {"kesir1": {"pay": 1, "payda": 2}}); iki düzey iç içe nesne düşer.
 */
export interface TemplateParams {
  schema_version?: "1.0";
  id: string;
  seed?: number;
  params: {
    [k: string]: Value | undefined;
  };
}
