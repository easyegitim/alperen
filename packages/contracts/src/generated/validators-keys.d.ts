/* Bu dosya scripts/gen.ts tarafından üretilir; elle düzenlenmez (bun run gen). */
export interface StandaloneError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  params: Record<string, unknown>;
  message?: string;
}
export interface StandaloneValidate {
  (data: unknown, ctx?: unknown): boolean;
  errors?: StandaloneError[] | null;
}
/** https://ogrenmen.easy/schemas/answer-key.json */
export declare const answerKey: StandaloneValidate;
/** https://ogrenmen.easy/schemas/diagnostic-keys.json */
export declare const diagnosticKeys: StandaloneValidate;
/** https://ogrenmen.easy/schemas/diagnostic-keys.json#/$defs/key */
export declare const diagnosticKeysKey: StandaloneValidate;
/** https://ogrenmen.easy/schemas/question-generation.json */
export declare const questionGeneration: StandaloneValidate;
/** https://ogrenmen.easy/schemas/question-generation.json#/$defs/key */
export declare const questionGenerationKey: StandaloneValidate;
