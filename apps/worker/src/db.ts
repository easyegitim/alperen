/**
 * Uygulama veritabanı havuzu (`pg`). Bağlantı service role (RLS atlanır) ya da doğrudan Postgres rolüdür;
 * yalnız apps/worker kullanır (docs/PLAN-v2-detail.md §2.4). pg-boss kendi havuzunu ayrıca açar.
 */
import pg from 'pg';

/** İşlerin gördüğü en dar veritabanı arayüzü (`pg.Pool` ve testlerdeki sahte uyumlu). */
export interface Db {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

export interface DbPool extends Db {
  end(): Promise<void>;
}

export function createPool(opts: { databaseUrl: string; max?: number; applicationName?: string }): pg.Pool {
  const pool = new pg.Pool({
    connectionString: opts.databaseUrl,
    max: opts.max ?? 8,
    application_name: opts.applicationName ?? 'ogrenmen-worker',
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  // Boştaki bağlantı hatası süreci düşürmesin (pg yayar); havuz bağlantıyı yeniler.
  pool.on('error', (err) => {
    process.stderr.write(JSON.stringify({ t: new Date().toISOString(), level: 'error', msg: 'db havuzu: boşta bağlantı hatası', error: err.message }) + '\n');
  });
  return pool;
}

export async function pingDb(db: Db, timeoutMs = 3_000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db.query('select 1'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('db ping zaman aşımı')), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
