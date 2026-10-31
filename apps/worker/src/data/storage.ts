/**
 * Supabase Storage istemcisi. `figures` kovası public-read'dir (PII yok; uuid adlı): Telegram
 * `sendPhoto(photo=<public URL>)` dosyayı doğrudan çeker. Silme `storage_deletions` kuyruğundan,
 * `bot_runtime` JWT ile (§3.6 0017 politikaları).
 */
import type { FetchFn } from '../telegram/client.ts';

export interface StorageApi {
  /** `figures/<id>.png` gibi kova önekli yol → herkese açık URL. */
  publicUrl(path: string): string;
  signedUrl(bucket: string, path: string, ttlSeconds: number): Promise<string | null>;
  remove(bucket: string, path: string): Promise<void>;
}

export class SupabaseStorage implements StorageApi {
  constructor(private readonly o: { url: string; anonKey: string; botJwt: string; fetch: FetchFn }) {}

  publicUrl(path: string): string {
    const clean = path.replace(/^\/+/, '');
    return `${this.o.url}/storage/v1/object/public/${clean.startsWith('figures/') ? clean : `figures/${clean}`}`;
  }

  async signedUrl(bucket: string, path: string, ttlSeconds: number): Promise<string | null> {
    const res = await this.o.fetch(`${this.o.url}/storage/v1/object/sign/${bucket}/${path}`, {
      method: 'POST',
      headers: { apikey: this.o.anonKey, authorization: `Bearer ${this.o.botJwt}`, 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: ttlSeconds }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { signedURL?: string };
    return typeof body.signedURL === 'string' ? `${this.o.url}/storage/v1${body.signedURL}` : null;
  }

  async remove(bucket: string, path: string): Promise<void> {
    const res = await this.o.fetch(`${this.o.url}/storage/v1/object/${bucket}/${path.replace(new RegExp(`^${bucket}/`), '')}`, {
      method: 'DELETE',
      headers: { apikey: this.o.anonKey, authorization: `Bearer ${this.o.botJwt}` },
    });
    if (!res.ok && res.status !== 404) throw new Error(`storage ${res.status}`);
  }
}
