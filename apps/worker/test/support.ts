/** Öneri motoru ve gece işleri testlerinin ortak sahteleri (sahte veritabanı yönlendiricisi + iş bağlamı). */
import { FakeTransport, Gateway, InMemoryLedger } from '@ogrenmen/llm';
import { loadConfig } from '../src/config.js';
import type { Db } from '../src/db.js';
import type { EnqueueOptions, JobContext } from '../src/jobs/types.js';
import { silentLogger } from '../src/log.js';
import { UNCONFIGURED_PUSH } from '../src/push.js';

export type Call = { text: string; values: unknown[] | undefined };
export type Route = [RegExp, (values: unknown[] | undefined, text: string) => Record<string, unknown>[] | { rows: Record<string, unknown>[]; rowCount: number }];

/** Sorgu metnini sırayla desenlerle eşler; eşleşmeyen sorgu boş satır döner. */
export function routedDb(routes: Route[] = []): Db & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      for (const [re, fn] of routes) {
        if (re.test(text)) {
          const out = fn(values, text);
          return Array.isArray(out) ? { rows: out, rowCount: out.length } : out;
        }
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

export interface Enqueued {
  name: string;
  data: object;
  opts?: EnqueueOptions;
}

export function jobCtx(over: Partial<JobContext> & { transport?: FakeTransport } = {}): JobContext & { ledger: InMemoryLedger; enqueued: Enqueued[]; transport: FakeTransport } {
  const ledger = new InMemoryLedger();
  const transport = over.transport ?? new FakeTransport();
  const gateway = new Gateway({ transport, ledger });
  const enqueued: Enqueued[] = [];
  const { transport: _t, ...rest } = over;
  const base: JobContext = {
    config: loadConfig({ DATABASE_URL: 'postgresql://u:p@h:5432/d' }, []),
    log: silentLogger,
    db: routedDb(),
    gateway: async () => gateway,
    storage: () => {
      throw new Error('storage yok');
    },
    pdf: { render: async () => ({ pdf: Buffer.from('%PDF-'), pages: 1, bytes: 5 }), close: async () => undefined },
    push: UNCONFIGURED_PUSH,
    enqueue: async (name, data, opts) => {
      enqueued.push({ name, data, ...(opts ? { opts } : {}) });
      return `job-${enqueued.length}`;
    },
    now: () => new Date('2026-11-03T00:00:00Z'),
    job: { id: 'job-1', name: 'test', retryCount: 0 },
    signal: new AbortController().signal,
  };
  return Object.assign({ ...base, ...rest }, { ledger, enqueued, transport });
}
