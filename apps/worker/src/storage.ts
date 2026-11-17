/** Supabase Storage istemcisi (supabase-js, service key). Yalnız worker kullanır; kullanıcı yolu yok. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface StorageLike {
  upload(bucket: string, path: string, body: Uint8Array | Buffer, contentType: string): Promise<void>;
  download(bucket: string, path: string): Promise<Buffer>;
  createSignedUrl(bucket: string, path: string, expiresInSec: number): Promise<string>;
  /** Nesneleri siler (yoksa sessiz geçer). */
  remove?(bucket: string, paths: string[]): Promise<void>;
}

export class StorageError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'StorageError';
  }
}

/** Yol denetimi: kovada yukarı çıkış ve boş bölüm yok. */
export function assertStoragePath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('//') || path.split('/').some((s) => s === '..' || s === '.')) {
    throw new StorageError(`geçersiz depolama yolu: ${path}`);
  }
  return path;
}

export class SupabaseStorage implements StorageLike {
  constructor(private readonly client: SupabaseClient) {}

  async upload(bucket: string, path: string, body: Uint8Array | Buffer, contentType: string): Promise<void> {
    const { error } = await this.client.storage.from(bucket).upload(assertStoragePath(path), body, { contentType, upsert: true });
    if (error) throw new StorageError(`yükleme başarısız (${bucket}/${path}): ${error.message}`, error);
  }

  async download(bucket: string, path: string): Promise<Buffer> {
    const { data, error } = await this.client.storage.from(bucket).download(assertStoragePath(path));
    if (error || !data) throw new StorageError(`indirme başarısız (${bucket}/${path}): ${error?.message ?? 'boş yanıt'}`, error);
    return Buffer.from(await data.arrayBuffer());
  }

  async remove(bucket: string, paths: string[]): Promise<void> {
    const { error } = await this.client.storage.from(bucket).remove(paths.map(assertStoragePath));
    if (error) throw new StorageError(`silme başarısız (${bucket}): ${error.message}`, error);
  }

  async createSignedUrl(bucket: string, path: string, expiresInSec: number): Promise<string> {
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(assertStoragePath(path), expiresInSec);
    if (error || !data) throw new StorageError(`imzalı adres üretilemedi (${bucket}/${path}): ${error?.message ?? 'boş yanıt'}`, error);
    return data.signedUrl;
  }
}

/** Anahtarlar yoksa null (işler kullanmaya kalkışınca anlamlı hata verir). */
export function createStorage(opts: { url: string | null; serviceKey: string | null }): StorageLike | null {
  if (!opts.url || !opts.serviceKey) return null;
  const client = createClient(opts.url, opts.serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  return new SupabaseStorage(client);
}
