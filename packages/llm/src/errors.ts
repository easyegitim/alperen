/**
 * Geçit hataları (OGR-LLM-*). Her hata defterdeki `status` değerini ve yeniden denenebilirliği taşır;
 * apps/worker pg-boss geri çekilmesini `retryable` alanına göre seçer (429/529 → yeniden dene).
 */
import {
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  InternalServerError,
  RateLimitError,
} from '@anthropic-ai/sdk';
import type { RefusalInfo } from './refusal.js';

/** `public.llm_calls.status` değerleri (supabase/migrations/0014_llm_ledger.sql). */
export type LedgerStatus =
  | 'ok'
  | 'error'
  | 'rate_limited'
  | 'overloaded'
  | 'timeout'
  | 'cap_blocked'
  | 'bad_output'
  | 'refusal'
  | 'max_tokens';

export class LlmError extends Error {
  readonly code: string;
  readonly status: LedgerStatus;
  readonly retryable: boolean;
  constructor(code: string, message: string, opts: { status: LedgerStatus; retryable?: boolean; cause?: unknown }) {
    super(`${code} ${message}`, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'LlmError';
    this.code = code;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}

/** Rota tablosu ya da girdi hatası (programcı hatası; yeniden denenmez). */
export class RouteConfigError extends LlmError {
  constructor(message: string) {
    super('OGR-LLM-001', message, { status: 'error' });
    this.name = 'RouteConfigError';
  }
}

/** Model reddi (`stop_reason: "refusal"`). Yapılandırılmış rotalarda fırlatılır; sohbet rotaları sonucu döndürür. */
export class RefusalError extends LlmError {
  readonly refusal: RefusalInfo;
  constructor(refusal: RefusalInfo) {
    super('OGR-LLM-002', `model reddetti (kategori: ${refusal.category ?? 'yok'})`, { status: 'refusal' });
    this.name = 'RefusalError';
    this.refusal = refusal;
  }
}

/** Onarım turundan sonra da şemaya uymayan çıktı. Kısmi analiz asla saklanmaz. */
export class ParseError extends LlmError {
  readonly issues: string;
  readonly rawText: string;
  constructor(issues: string, rawText: string) {
    super('OGR-LLM-003', `yapılandırılmış çıktı şemaya uymadı (onarım turu sonrası): ${issues}`, { status: 'bad_output' });
    this.name = 'ParseError';
    this.issues = issues;
    this.rawText = rawText;
  }
}

/** İki kat `max_tokens` ile yeniden denemeden sonra da kesilen yanıt. */
export class MaxTokensError extends LlmError {
  readonly maxTokens: number;
  constructor(maxTokens: number) {
    super('OGR-LLM-004', `yanıt max_tokens=${maxTokens} sınırında kesildi (iki kat yeniden deneme sonrası)`, { status: 'max_tokens' });
    this.name = 'MaxTokensError';
    this.maxTokens = maxTokens;
  }
}

/** Araç döngüsü sınırı aşıldı. */
export class ToolLoopError extends LlmError {
  constructor(message: string) {
    super('OGR-LLM-005', message, { status: 'error' });
    this.name = 'ToolLoopError';
  }
}

/** Batch sonucu alınamadı / beklenmeyen durum. */
export class BatchError extends LlmError {
  constructor(message: string, retryable = false) {
    super('OGR-LLM-006', message, { status: 'error', retryable });
    this.name = 'BatchError';
  }
}

/** Geçersiz `student_ref` (yalnız `students.public_ref`; uuid ya da ad asla). API isteğinden önce fırlatılır. */
export class StudentRefError extends LlmError {
  constructor(ref: string) {
    super('OGR-LLM-008', `student_ref yalnız students.public_ref olabilir (s_xxxx): ${ref.slice(0, 4)}…`, { status: 'error' });
    this.name = 'StudentRefError';
  }
}

/**
 * Model ortadaki `role:"system"` mesajını desteklemiyor mu (400 `role 'system' is not supported on this model`;
 * claude-api shared/prompt-caching.md). Geçit bu durumda bir kez `<system-reminder>` yedeğiyle yeniden dener.
 */
export function isSystemRoleUnsupported(err: unknown): boolean {
  if (!(err instanceof APIError) || err.status !== 400) return false;
  return /role\W{0,3}system\W{0,3}(is\s+)?not\s+supported/i.test(err.message);
}

/** SDK hatasını defter durumuna eşler (sınıf adına göre; ileti metni eşlenmez). */
export function classifyError(err: unknown): { status: LedgerStatus; retryable: boolean; code: string } {
  if (err instanceof LlmError) return { status: err.status, retryable: err.retryable, code: err.code };
  if (err instanceof APIUserAbortError) return { status: 'error', retryable: false, code: 'aborted' };
  if (err instanceof APIConnectionTimeoutError) return { status: 'timeout', retryable: true, code: 'timeout' };
  if (err instanceof RateLimitError) return { status: 'rate_limited', retryable: true, code: '429' };
  if (err instanceof InternalServerError && err.status === 529) return { status: 'overloaded', retryable: true, code: '529' };
  if (err instanceof APIError) {
    const s = typeof err.status === 'number' ? err.status : 0;
    return { status: 'error', retryable: s >= 500, code: s ? String(s) : 'api_error' };
  }
  return { status: 'error', retryable: false, code: 'unknown' };
}
