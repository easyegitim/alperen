/**
 * Ders başına tarz kütüphanesi kilidi (style.ingest 4.–5. adım). İki çıkmış sınav yüklemesi art arda gelirse iki
 * style.ingest işi aynı dersin kümelerini aynı anda yeniden kurabilir: kod çakışır, aynı küme iki farklı adla adlanır.
 * Kilit oturum düzeyi `pg_advisory_lock`tur ve tek bir bağlantıda tutulmalıdır: `pg.Pool` bağlantı verirse (connect)
 * kilit ayrılmış bir bağlantıda alınır ve bağlantı bırakılınca serbest kalır (işçi çökerse Postgres kilidi de bırakır).
 * Bağlantı vermeyen sahte veritabanlarında (testler) iş kilitsiz çalışır; üretimde havuz vardır.
 */
import type { Db } from '../db.js';

export interface LockClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(err?: Error | boolean): void;
}

interface Connectable {
  connect?: () => Promise<LockClient>;
}

export function courseLockKey(courseId: string): string {
  return `style-lib:${courseId}`;
}

export async function withCourseLibraryLock<T>(db: Db, courseId: string, fn: () => Promise<T>): Promise<T> {
  const connect = (db as Db & Connectable).connect;
  if (typeof connect !== 'function') return fn();
  const client = await connect.call(db);
  let broken: Error | undefined;
  try {
    await client.query('select pg_advisory_lock(hashtextextended($1, 0))', [courseLockKey(courseId)]);
    try {
      return await fn();
    } finally {
      await client.query('select pg_advisory_unlock(hashtextextended($1, 0))', [courseLockKey(courseId)]).catch((e: unknown) => {
        broken = e instanceof Error ? e : new Error(String(e));
      });
    }
  } finally {
    // kilit açılamadıysa bağlantıyı yıkmak kilidi de bırakır (oturum kapanır)
    client.release(broken ?? false);
  }
}
