// SPEC 14.2. INTERNAL (500) SPEC listesinde yoktur; beklenmeyen hatalar için eklendi (gövde biçimi aynı).
export type ApiErrorCode =
  | "UNAUTHENTICATED" | "ANONYMOUS_NOT_ALLOWED" | "NOT_ADULT" | "CONSENT_REQUIRED"
  | "PREMIUM_REQUIRED" | "QUOTA_EXCEEDED" | "BAD_INPUT" | "IMAGE_TOO_LARGE" | "BAD_PRESET"
  | "NO_FACE" | "AI_SAFETY_BLOCKED" | "AI_FAILED" | "AI_TIMEOUT" | "ALREADY_SUBSCRIBED"
  | "FEATURE_DISABLED" | "RATE_LIMITED" | "CAPTURE_QUALITY" | "TRYON_QC_FAILED" | "INTERNAL";

export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  UNAUTHENTICATED: 401,
  ANONYMOUS_NOT_ALLOWED: 403,
  NOT_ADULT: 403,
  CONSENT_REQUIRED: 403,
  PREMIUM_REQUIRED: 402,
  QUOTA_EXCEEDED: 402,
  BAD_INPUT: 400,
  IMAGE_TOO_LARGE: 413,
  BAD_PRESET: 400,
  NO_FACE: 422,
  AI_SAFETY_BLOCKED: 422,
  AI_FAILED: 502,
  AI_TIMEOUT: 504,
  ALREADY_SUBSCRIBED: 409,
  FEATURE_DISABLED: 404,
  RATE_LIMITED: 429,
  // Sunucu çekim kapısı reserve_analysis'ten önce: hak düşmez (UI spec C13, engine spec §3.6).
  CAPTURE_QUALITY: 422,
  // Sanal deneme kalite kontrolü (KB Ç10): görsel gösterilmez, hak düşmez (tryon_events.status = qc_failed).
  TRYON_QC_FAILED: 422,
  INTERNAL: 500,
};

export type ApiErrorBody = { error: { code: ApiErrorCode; message: string; retryAt?: string } };

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly retryAt?: string;
  constructor(code: ApiErrorCode, message: string, retryAt?: string) {
    super(message);
    this.code = code;
    this.retryAt = retryAt;
  }
}

export function apiError(code: ApiErrorCode, message: string, retryAt?: string): Response {
  const body: ApiErrorBody = { error: { code, message, ...(retryAt ? { retryAt } : {}) } };
  return Response.json(body, { status: API_ERROR_STATUS[code] });
}

export function isApiErrorBody(v: unknown): v is ApiErrorBody {
  return typeof v === "object" && v !== null && "error" in v && typeof (v as ApiErrorBody).error?.code === "string";
}
