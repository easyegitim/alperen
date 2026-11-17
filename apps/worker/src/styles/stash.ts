/**
 * style.ingest ara çıktıları (sayfa OCR'ı, madde sınıflandırması): audit.events 'style.stash' satırları (row_id = kaynak,
 * diff = {key, data}). Yeniden deneme ücretli çağrıyı tekrarlamaz. audit şeması yalnız personel/worker okur; çıkmış soru
 * metni öğrenciye açılmaz.
 */
import type { Db } from '../db.js';

export const STYLE_STASH_ACTION = 'style.stash';

export async function stashGet<T>(db: Db, sourceId: string, key: string): Promise<T | null> {
  const r = await db.query(
    `select diff -> 'data' as data from audit.events
      where action = $1 and row_id = $2 and diff ->> 'key' = $3
      order by created_at desc, id desc limit 1`,
    [STYLE_STASH_ACTION, sourceId, key],
  );
  const row = r.rows[0];
  return row && row.data !== null && row.data !== undefined ? (row.data as T) : null;
}

export async function stashPut(db: Db, sourceId: string, key: string, data: unknown): Promise<void> {
  await db.query(`select app.audit_event($1, 'public.exam_sources', $2, $3::jsonb)`, [STYLE_STASH_ACTION, sourceId, JSON.stringify({ key, data })]);
}

export async function stashed<T>(db: Db, sourceId: string, key: string, make: () => Promise<T>): Promise<{ value: T; cached: boolean }> {
  const hit = await stashGet<T>(db, sourceId, key);
  if (hit !== null) return { value: hit, cached: true };
  const value = await make();
  await stashPut(db, sourceId, key, value);
  return { value, cached: false };
}
