import "server-only";

import { buildAuthorization, randomKey } from "./signature";

// SPEC 15.1 madde 5: tek iyzicoRequest yardımcısı, IYZWSv2 HMAC-SHA256.
// İmza biçimi lib/billing/signature.ts (resmi SDK'dan birebir); x-iyzi-rnd başlığı randomKey'i taşır.
// GET isteklerinde de gövde "{}" olarak imzaya girer ve gönderilir (SDK davranışı).

export type IyzicoMethod = "GET" | "POST" | "DELETE";

export class IyzicoError extends Error {
  constructor(
    readonly errorCode: string | undefined,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
  }
}

/** Anahtarlar tanımlı mı (boş/yalnız boşluk = yok). Ödeme başlatmadan önce sorulur: eksikse bekleyen satır açılmaz. */
export function iyzicoConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.IYZICO_API_KEY?.trim() && env.IYZICO_SECRET_KEY?.trim());
}

export function iyzicoEnv() {
  const apiKey = process.env.IYZICO_API_KEY;
  const secretKey = process.env.IYZICO_SECRET_KEY;
  const baseUrl = (process.env.IYZICO_BASE_URL || "https://sandbox-api.iyzipay.com").replace(/\/$/, "");
  if (!apiKey || !secretKey) throw new Error("IYZICO_API_KEY / IYZICO_SECRET_KEY eksik");
  return { apiKey, secretKey, baseUrl };
}

export type IyzicoResponse = { status?: "success" | "failure"; errorCode?: string; errorMessage?: string; [k: string]: unknown };

export async function iyzicoRequest<T extends IyzicoResponse = IyzicoResponse>(method: IyzicoMethod, path: string, body: Record<string, unknown> = {}): Promise<T> {
  const { apiKey, secretKey, baseUrl } = iyzicoEnv();
  const rnd = randomKey();
  const bodyJson = JSON.stringify(body);
  const res = await fetch(baseUrl + path, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "x-iyzi-rnd": rnd,
      "x-iyzi-client-version": "aura-next",
      authorization: buildAuthorization(apiKey, secretKey, path, bodyJson, rnd),
    },
    body: bodyJson,
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok || data.status !== "success") {
    throw new IyzicoError(data.errorCode, data.errorMessage ?? `iyzico HTTP ${res.status}`, res.status);
  }
  return data;
}
