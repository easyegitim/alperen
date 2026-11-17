// RPC çağrısı için en küçük arayüz: supabase-js istemcisi (kullanıcının JWT'si; RLS ve SECURITY DEFINER denetimleri
// geçerli) bunu yapısal olarak karşılar; canlı testler aynı arayüzü gerçek Postgres'e bağlar (test/student-flow.db.test.ts).
// server-only içe aktarmaz: saf modüllerin ve testlerin kullanımı içindir.

export interface RpcError {
  code?: string | null;
  message: string;
  details?: string | null;
}

export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

export type RpcResult<T> = { ok: true; data: T } | { ok: false; error: RpcError; code: string | null };

/** OGR-XXX-000 biçimli uygulama hata kodunu iletiden çıkarır (yoksa PostgREST/Postgres kodu). */
export function appErrorCode(err: RpcError | null | undefined): string | null {
  if (!err) return null;
  const m = /OGR-[A-Z]+-\d{3}/.exec(err.message ?? '');
  return m ? m[0] : (err.code ?? null);
}

/** RPC'yi çağırır ve sonucu ayrıştırıcıdan geçirir; ayrıştırma hatası da `ok: false` döner. */
export async function callRpc<T>(client: RpcClient, fn: string, args: Record<string, unknown>, parse: (raw: unknown) => T): Promise<RpcResult<T>> {
  const { data, error } = await client.rpc(fn, args);
  if (error) return { ok: false, error, code: appErrorCode(error) };
  try {
    return { ok: true, data: parse(data) };
  } catch (e) {
    const error: RpcError = { code: 'OGR-WEB-001', message: `OGR-WEB-001 ${fn} yanıtı beklenen biçimde değil: ${(e as Error).message}` };
    return { ok: false, error, code: 'OGR-WEB-001' };
  }
}

/** PostgREST "fonksiyon yok" (göç uygulanmamış ya da şema önbelleği eski). */
export function isMissingFunction(err: RpcError | null | undefined): boolean {
  return err?.code === 'PGRST202' || err?.code === '42883';
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}
