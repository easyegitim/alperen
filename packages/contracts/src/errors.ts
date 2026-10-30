/** Doğrulama hata biçimi: çalışma zamanı (`validate.ts`) ve önceden derlenmiş (`validators.ts`) yol aynıdır. */

export interface ContractIssue {
  /** Hatalı değerin JSON Pointer yolu ("" = kök). */
  path: string;
  /** Düşen anahtar kelime (`required`, `additionalProperties`, `x-forbidden-words` …). */
  keyword: string;
  /** İnsan okunur ileti. */
  message: string;
  /** Ajv'nin anahtar kelime parametreleri (ör. `{ additionalProperty: 'correct_option' }`). */
  params: Record<string, unknown>;
}

interface AjvLikeError {
  instancePath?: string;
  keyword: string;
  message?: string;
  params?: Record<string, unknown>;
}

export function toIssues(errors: readonly AjvLikeError[] | null | undefined): ContractIssue[] {
  return (errors ?? []).map((e) => ({
    path: e.instancePath ?? '',
    keyword: e.keyword,
    message: e.message ?? e.keyword,
    params: e.params ?? {},
  }));
}

/** Sözleşmeye uymayan veri; `issues` tüm hataları taşır (`allErrors`). */
export class ContractValidationError extends Error {
  readonly schemaId: string;
  readonly issues: ContractIssue[];

  constructor(schemaId: string, issues: ContractIssue[]) {
    const head = issues
      .slice(0, 5)
      .map((i) => `${i.path || '/'} ${i.message}`)
      .join('; ');
    super(`OGR-CONTRACT-001 ${schemaId} doğrulaması düştü (${issues.length} hata): ${head}`);
    this.name = 'ContractValidationError';
    this.schemaId = schemaId;
    this.issues = issues;
  }
}
