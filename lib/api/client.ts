"use client";

import { isApiErrorBody, type ApiErrorBody } from "./errors";

export class ApiClientError extends Error {
  readonly code: ApiErrorBody["error"]["code"] | "NETWORK";
  readonly status: number;
  readonly retryAt?: string;
  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error.message ?? "Ağ hatası");
    this.status = status;
    this.code = body?.error.code ?? "NETWORK";
    this.retryAt = body?.error.retryAt;
  }
}

/** JSON POST; hata gövdesini ApiClientError'a çevirir. 204'te null döner. */
export async function postJson<T = unknown>(path: string, body: unknown): Promise<T | null> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.status === 204) return null;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiClientError(res.status, isApiErrorBody(data) ? data : null);
  return data as T;
}
