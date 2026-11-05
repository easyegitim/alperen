/** Prompt paketi hataları. Kodlar `OGR-PRM-00x`; iletiler Türkçe. */
export type PromptErrorCode =
  | 'OGR-PRM-001' // front-matter biçimi bozuk
  | 'OGR-PRM-002' // meta alanı geçersiz
  | 'OGR-PRM-003' // bilinmeyen rota / sürüm
  | 'OGR-PRM-004' // katman ya da extends dosyası yok
  | 'OGR-PRM-005' // metin kuralı ihlali (lint)
  | 'OGR-PRM-006'; // kilit (prompts.lock.json) sapması

export class PromptError extends Error {
  override readonly name = 'PromptError';
  constructor(
    readonly code: PromptErrorCode,
    message: string,
  ) {
    super(`${code} ${message}`);
  }
}
