/**
 * secure.job_outbox → pg-boss aktarımı (`outbox.drain`, supabase/migrations/0029_job_outbox.sql). enqueue_job pgboss.job'a
 * yazamadığında (şema yok, sahip yetkisiz, kuyruk yok) işi outbox'a koyar; worker kendi bağlantısıyla (pgboss'a yetkili
 * rol) aktarır. Tek işlem: `FOR UPDATE SKIP LOCKED` ile satırları kilitler, her satır için kayıt noktası içinde
 * `boss.send(name, data, { id: outbox.id, db: <bu işlem> })` ve `DELETE`; düşen satırda `attempts`, `retried_at`,
 * `last_error` güncellenir ve `retryAfterSeconds` sonra yeniden denenir. İş kimliği outbox kimliğidir: aynı satır iki kez
 * aktarılamaz (işlem atomik; pg-boss aynı kimliği ikinci kez eklemez). Birden çok worker güvenle aynı anda çalışır.
 * Sonuç bekleyen sayıyı, en eski satırın yaşını ve takılı (`attempts >= 3`) satırları da verir; takılı satır ya da bir
 * saatten eski bekleyen iş `log.error` yazar, son sonuç /healthz `outbox` alanında görünür.
 */
import type { Logger } from './log.js';

/** pg-boss `ConnectionOptions.db` (IDatabase) ile uyumlu. */
export interface TxDb {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface TxClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
  release(err?: Error | boolean): void;
}

export interface TxPool {
  connect(): Promise<TxClient>;
}

export interface OutboxDrainDeps {
  pool: TxPool;
  /** İşi verilen işlem içinde pg-boss'a ekler; kimlik ya da null (zaten var / politika çakışması) döner. */
  send(name: string, data: object, id: string, db: TxDb): Promise<string | null>;
  /** Kuyruk açık mı (pg-boss send kuyruk yoksa hata verir; ileti açık olsun diye önceden bakılır). */
  queueExists(name: string): Promise<boolean>;
  log?: Logger;
  /** Bir işlemde en çok satır (varsayılan 100). */
  batchSize?: number;
  /** Bir çağrıda en çok işlem (varsayılan 10). */
  maxBatches?: number;
  /** Düşen satır en erken bu kadar sonra yeniden denenir (sn; varsayılan 300). */
  retryAfterSeconds?: number;
}

export interface OutboxDrainResult {
  moved: number;
  failed: number;
  /** Çağrı sonunda bekleyen (henüz aktarılmamış) satır. */
  pending: number;
  /** En eski bekleyen satırın yaşı (sn; bekleyen yoksa 0). */
  oldestAgeSec: number;
  /** `attempts >= STUCK_ATTEMPTS` olan (takılı) satır. */
  stuck: number;
  /** Aktarılan iş adları ve sayıları. */
  byName: Record<string, number>;
}

/** Bu kadar denemede aktarılamayan satır takılı sayılır (kuyruk yok, kalıcı INSERT hatası). */
export const STUCK_ATTEMPTS = 3;
/** En eski bekleyen satır bundan yaşlıysa (sn) aktarım işlemiyor demektir. */
export const STALE_AGE_SEC = 3600;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function drainOutbox(deps: OutboxDrainDeps): Promise<OutboxDrainResult> {
  const batchSize = deps.batchSize ?? 100;
  const maxBatches = deps.maxBatches ?? 10;
  const retryAfter = deps.retryAfterSeconds ?? 300;
  const result: OutboxDrainResult = { moved: 0, failed: 0, pending: 0, oldestAgeSec: 0, stuck: 0, byName: {} };
  const queueCache = new Map<string, boolean>();
  const exists = async (name: string) => {
    if (!queueCache.has(name)) queueCache.set(name, await deps.queueExists(name));
    return queueCache.get(name)!;
  };

  for (let batch = 0; batch < maxBatches; batch++) {
    const client = await deps.pool.connect();
    let rows: { id: string; name: string; data: unknown }[] = [];
    let broken: Error | undefined;
    try {
      await client.query('begin');
      rows = (
        await client.query(
          `select o.id::text as id, o.name, o.data
             from secure.job_outbox o
            where o.retried_at is null or o.retried_at < now() - make_interval(secs => $1)
            order by o.created_at, o.id
            for update skip locked
            limit $2`,
          [retryAfter, batchSize],
        )
      ).rows as typeof rows;
      const tx: TxDb = { executeSql: (text, values) => client.query(text, values) };
      for (const row of rows) {
        await client.query('savepoint outbox_row');
        try {
          if (!(await exists(row.name))) throw new Error(`kuyruk yok: ${row.name}`);
          const data = row.data && typeof row.data === 'object' ? (row.data as object) : {};
          await deps.send(row.name, data, row.id, tx);
          await client.query('delete from secure.job_outbox where id = $1', [row.id]);
          await client.query('release savepoint outbox_row');
          result.moved++;
          result.byName[row.name] = (result.byName[row.name] ?? 0) + 1;
        } catch (err) {
          await client.query('rollback to savepoint outbox_row');
          await client.query(
            `update secure.job_outbox set attempts = attempts + 1, retried_at = now(), last_error = left($2, 2000) where id = $1`,
            [row.id, errMsg(err)],
          );
          result.failed++;
          deps.log?.warn('outbox satırı aktarılamadı', { outboxId: row.id, job: row.name, error: errMsg(err) });
        }
      }
      await client.query('commit');
    } catch (err) {
      broken = err as Error;
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release(broken);
    }
    if (rows.length < batchSize) break;
  }

  const c = await deps.pool.connect();
  try {
    const row = (
      await c.query(
        `select count(*)::int as n,
                coalesce(floor(extract(epoch from now() - min(created_at))), 0)::int as oldest_age_sec,
                (count(*) filter (where attempts >= $1))::int as stuck
           from secure.job_outbox`,
        [STUCK_ATTEMPTS],
      )
    ).rows[0];
    result.pending = Number(row?.n ?? 0);
    result.oldestAgeSec = Number(row?.oldest_age_sec ?? 0);
    result.stuck = Number(row?.stuck ?? 0);
  } finally {
    c.release();
  }
  if (result.moved > 0 || result.failed > 0) deps.log?.info('outbox aktarıldı', { moved: result.moved, failed: result.failed, pending: result.pending, byName: result.byName });
  // Takılı ya da eskimiş satır: SQL işi kuyruğa ulaşmıyor; uyarı değil hata (üretimde alarm).
  if (result.stuck > 0 || result.oldestAgeSec > STALE_AGE_SEC) {
    deps.log?.error('outbox aktarılamayan işler birikiyor', { pending: result.pending, stuck: result.stuck, oldestAgeSec: result.oldestAgeSec, stuckAttempts: STUCK_ATTEMPTS, staleAgeSec: STALE_AGE_SEC });
  }
  return result;
}
