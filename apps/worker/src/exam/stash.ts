/**
 * Hattın ara çıktıları (model yanıtları, okunan sayfalar): audit.events 'exam.stash' satırları (row_id = oturum,
 * diff = {key, data}). Yeniden deneme ücretli çağrıyı tekrarlamaz; son yazılan değer geçerlidir. Öğrenciye açılmaz
 * (audit şeması yalnız personel/worker).
 */
import type { Db } from '../db.js';

export const STASH_ACTION = 'exam.stash';

export async function stashGet<T>(db: Db, sessionId: string, key: string): Promise<T | null> {
  const r = await db.query(
    `select diff -> 'data' as data from audit.events
      where action = $1 and row_id = $2 and diff ->> 'key' = $3
      order by created_at desc, id desc limit 1`,
    [STASH_ACTION, sessionId, key],
  );
  const row = r.rows[0];
  return row && row.data !== null && row.data !== undefined ? (row.data as T) : null;
}

export async function stashPut(db: Db, sessionId: string, key: string, data: unknown): Promise<void> {
  await db.query(`select app.audit_event($1, 'public.exam_sessions', $2, $3::jsonb)`, [STASH_ACTION, sessionId, JSON.stringify({ key, data })]);
}

/** Önce stash; yoksa üret, yaz, dön. */
export async function stashed<T>(db: Db, sessionId: string, key: string, make: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
  const hit = await stashGet<T>(db, sessionId, key);
  if (hit !== null) return { value: hit, cached: true };
  const value = await make();
  await stashPut(db, sessionId, key, value);
  return { value, cached: false };
}
