/** Sahte Storage: publicUrl deterministik `http://fake-storage/figures/<id>.png`; remove() çağrıları kaydedilir. */
import type { StorageApi } from '../../src/data/storage.ts';

export class FakeStorage implements StorageApi {
  readonly removed: Array<{ bucket: string; path: string }> = [];
  failRemove = false;

  publicUrl(path: string): string {
    const clean = path.replace(/^\/+/, '');
    return `http://fake-storage/${clean.startsWith('figures/') ? clean : `figures/${clean}`}`;
  }

  async signedUrl(bucket: string, path: string, ttlSeconds: number): Promise<string | null> {
    return `http://fake-storage/sign/${bucket}/${path}?ttl=${ttlSeconds}`;
  }

  async remove(bucket: string, path: string): Promise<void> {
    if (this.failRemove) throw new Error('storage 500');
    this.removed.push({ bucket, path });
  }
}
