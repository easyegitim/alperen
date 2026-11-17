// AI sağlayıcı çağrıları için geçici hata (503 yoğunluk, 429 kota, 529 aşırı yük) tespiti ve yeniden deneme. Saf; birim testli.
// SDK'dan bağımsızdır: Anthropic/Gemini hata nesneleri sayısal "status" alanıyla ördek tiplemesiyle tanınır.
// Hata özetinde yalnız durum kodu, hata tipi, istek kimliği veya kısa mesaj vardır; görsel, istem veya yanıt içeriği asla loglanmaz.

const TRANSIENT = /\b(503|429|529)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded|overloaded_error|rate limit|Too Many Requests|Service Unavailable/i;

/** Geçici HTTP durumları: 408 zaman aşımı, 409 çakışma, 429 oran, 5xx ve 529 aşırı yük (engine spec §9.3). */
const TRANSIENT_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

type ErrorFields = { status?: unknown; type?: unknown; error?: unknown; requestID?: unknown };

function fields(e: unknown): ErrorFields {
  return typeof e === "object" && e !== null ? (e as ErrorFields) : {};
}

function numericStatus(e: unknown): number | undefined {
  const s = fields(e).status;
  return typeof s === "number" ? s : undefined;
}

export function isTransientAiError(e: unknown): boolean {
  const status = numericStatus(e);
  if (status !== undefined && TRANSIENT_STATUS.has(status)) return true;
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return TRANSIENT.test(msg);
}

/** Hata tipi: Anthropic SDK hatasında e.type, yoksa gövdedeki error.error.type ya da error.type. */
function errorType(e: unknown): string | undefined {
  const f = fields(e);
  if (typeof f.type === "string") return f.type;
  // Anthropic gövdesi {type:"error", error:{type:"overloaded_error"}}: iç tip önce.
  const body = fields(f.error);
  const inner = fields(body.error);
  if (typeof inner.type === "string") return inner.type;
  return typeof body.type === "string" ? body.type : undefined;
}

/**
 * Loga uygun kısa özet. Sayısal status taşıyan hata (Anthropic): "status tip istekKimliği" (≤ 100 karakter).
 * {"error":{"code":503,...}} gövdeli ileti (Gemini): kod + durum + kısa mesaj; yoksa mesajın ilk 120 karakteri.
 */
export function aiErrorSummary(e: unknown): string {
  const status = numericStatus(e);
  const reqId = fields(e).requestID;
  if (status !== undefined && (errorType(e) !== undefined || typeof reqId === "string")) {
    return `${status} ${errorType(e) ?? "-"} ${typeof reqId === "string" ? reqId : "-"}`.slice(0, 100);
  }
  const msg = e instanceof Error ? e.message : String(e);
  try {
    const j = JSON.parse(msg) as { error?: { code?: number; status?: string; message?: string } };
    if (j?.error) return `${j.error.code ?? "?"} ${j.error.status ?? ""} ${(j.error.message ?? "").slice(0, 80)}`.trim();
  } catch {
    // düz metin
  }
  return msg.replace(/\s+/g, " ").slice(0, 120);
}

export type RetryOptions = {
  /** Toplam deneme = 1 + retries. */
  retries: number;
  baseDelayMs: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (attempt: number, error: unknown) => void;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Geçici hatada üstel bekleme ile tekrar; kalıcı hata veya iptal anında fırlatılır. */
export async function withTransientRetry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (attempt >= opts.retries || !isTransientAiError(e) || opts.signal?.aborted) throw e;
      opts.onRetry?.(attempt + 1, e);
      await sleep(opts.baseDelayMs * 2 ** attempt);
      if (opts.signal?.aborted) throw e;
    }
  }
}
