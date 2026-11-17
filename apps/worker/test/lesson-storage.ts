/**
 * Ders testlerinin bellek içi Storage'ı: gerçek Supabase gibi kovanın MIME izin listesini zorlar (izinsiz tür →
 * 415 invalid_mime_type). Liste göçlerden okunur (0015'teki kova tanımı + 0039'un eklediği türler), böylece hattın
 * yüklediği bir tür (ör. sahne karesi image/jpeg) kovada yoksa test düşer.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StorageLike } from '../src/storage.js';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'supabase', 'migrations');

function quoted(s: string): string[] {
  return [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

/** 'lessons' kovasının göçlerden çıkan MIME izin listesi. */
export function lessonBucketMimes(): Set<string> {
  const base = readFileSync(join(MIGRATIONS, '0015_storage.sql'), 'utf8');
  const def = /\('lessons',\s*'lessons',\s*false,\s*\d+,\s*array\[([^\]]+)\]/.exec(base);
  if (!def) throw new Error('0015_storage.sql: lessons kovası tanımı bulunamadı');
  const out = new Set(quoted(def[1]!));
  const v2 = readFileSync(join(MIGRATIONS, '0039_lessons_v2.sql'), 'utf8');
  const add = /allowed_mime_types\s*\|\|\s*array\[([^\]]+)\]/.exec(v2);
  for (const t of add ? quoted(add[1]!) : []) out.add(t);
  return out;
}

export class StorageMimeError extends Error {
  readonly status = 415;
  constructor(bucket: string, type: string) {
    super(`invalid_mime_type: ${bucket} kovası ${type} kabul etmiyor`);
  }
}

export class MemoryStorage implements StorageLike {
  readonly objects = new Map<string, { body: Buffer; type: string }>();
  readonly allowed: Record<string, Set<string>> = { lessons: lessonBucketMimes() };

  async upload(bucket: string, path: string, body: Uint8Array | Buffer, contentType: string): Promise<void> {
    const allowed = this.allowed[bucket];
    if (allowed && !allowed.has(contentType)) throw new StorageMimeError(bucket, contentType);
    this.objects.set(`${bucket}/${path}`, { body: Buffer.from(body), type: contentType });
  }
  async download(bucket: string, path: string): Promise<Buffer> {
    const o = this.objects.get(`${bucket}/${path}`);
    if (!o) throw new Error(`nesne yok: ${bucket}/${path}`);
    return o.body;
  }
  async createSignedUrl(bucket: string, path: string): Promise<string> {
    return `memory://${bucket}/${path}`;
  }
  async remove(bucket: string, paths: string[]): Promise<void> {
    for (const p of paths) this.objects.delete(`${bucket}/${p}`);
  }
  /** Önekle başlayan nesne yolları (kova adıyla). */
  keys(prefix: string): string[] {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
  }
}
