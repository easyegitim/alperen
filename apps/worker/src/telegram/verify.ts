/**
 * Webhook kimliği (BLUEPRINT §5.1): gizli yol + `X-Telegram-Bot-Api-Secret-Token` sabit zamanlı eşitlik.
 * Workers çalışma zamanında `crypto.subtle.timingSafeEqual` kullanılır; Node'da (birim testleri)
 * aynı sabit zamanlı karşılaştırma elle yapılır.
 */

const encoder = new TextEncoder();

interface TimingSafeSubtle {
  timingSafeEqual?: (a: ArrayBufferView | ArrayBuffer, b: ArrayBufferView | ArrayBuffer) => boolean;
}

function manualEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** İki dizgeyi sabit zamanda karşılaştırır (uzunluklar farklıysa da aynı iş yapılır). */
export function constantTimeEqual(given: string, expected: string): boolean {
  const a = encoder.encode(given);
  const b = encoder.encode(expected);
  const sameLength = a.length === b.length;
  const left = sameLength ? a : b;
  const subtle = (globalThis.crypto?.subtle ?? {}) as unknown as TimingSafeSubtle;
  const eq = typeof subtle.timingSafeEqual === 'function' ? subtle.timingSafeEqual(left, b) : manualEqual(left, b);
  return sameLength && eq && expected.length > 0;
}

/** İstek webhook'a mı ve kimliği doğru mu: yol ve başlık birlikte. */
export function verifyWebhook(request: Request, path: string, secret: string): boolean {
  if (request.method !== 'POST') return false;
  const url = new URL(request.url);
  const pathOk = constantTimeEqual(url.pathname, `/telegram/${path}`);
  const header = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  const headerOk = constantTimeEqual(header, secret);
  return pathOk && headerOk && path.length > 0;
}
