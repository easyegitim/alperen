/**
 * Çağrı defteri: her API isteği (onarım turu ve yeniden deneme dahil) bir `public.llm_calls` satırı yazar
 * (supabase/migrations/0014_llm_ledger.sql). Öğrenci yalnız `students.public_ref` ile taşınır; uuid ya da ad asla.
 * Postgres yazıcı `pg` ile (apps/worker, service_role); bellek içi yazıcı testler ve yerel geliştirme için.
 */
import type { LedgerStatus } from './errors.js';
import type { TokenUsage } from './pricing.js';

export interface LedgerRow {
  route: string;
  /** Harcama amacı (spend_ledger anahtarı); varsayılan = rota. */
  purpose: string;
  provider: 'anthropic';
  model: string;
  effort: string | null;
  prompt_version: string | null;
  tokens_in: number;
  tokens_out: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  images: number | null;
  batch: boolean;
  status: LedgerStatus;
  /** Hata kodu ya da `stop_details.category`. */
  error_code: string | null;
  /** API'nin döndürdüğü `stop_reason` (sütunu yok; `error_code` boşsa oraya yazılmaz, yalnız bellek içi). */
  stop_reason: string | null;
  latency_ms: number | null;
  cost_usd: number;
  ref_table: string | null;
  ref_id: string | null;
  student_ref: string | null;
}

export interface LedgerWriter {
  /** Satırı yazar; Postgres'te `llm_calls.id` döner. */
  write(row: LedgerRow): Promise<number | null>;
}

export interface LedgerRowInput {
  route: string;
  purpose?: string;
  model: string;
  effort: string | null;
  promptVersion?: string | null;
  usage: TokenUsage;
  images?: number | null;
  batch: boolean;
  status: LedgerStatus;
  errorCode?: string | null;
  stopReason?: string | null;
  latencyMs?: number | null;
  costUsd: number;
  ref?: { table: string; id: string } | null;
  studentRef?: string | null;
}

const PUBLIC_REF = /^s_[a-z0-9]{6,32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Defter satırı kurar; `student_ref` uuid gibi görünürse reddeder (yalnız public_ref). */
export function buildLedgerRow(i: LedgerRowInput): LedgerRow {
  const studentRef = i.studentRef ?? null;
  if (studentRef !== null && (UUID.test(studentRef) || !PUBLIC_REF.test(studentRef))) {
    throw new Error(`OGR-LLM-008 student_ref yalnız students.public_ref olabilir (s_xxxx): ${studentRef.slice(0, 4)}…`);
  }
  return {
    route: i.route,
    purpose: i.purpose ?? i.route,
    provider: 'anthropic',
    model: i.model,
    effort: i.effort,
    prompt_version: i.promptVersion ?? null,
    tokens_in: i.usage.input,
    tokens_out: i.usage.output,
    cache_read_tokens: i.usage.cacheRead,
    cache_write_tokens: i.usage.cacheWrite5m + i.usage.cacheWrite1h,
    images: i.images ?? null,
    batch: i.batch,
    status: i.status,
    error_code: i.errorCode ?? null,
    stop_reason: i.stopReason ?? null,
    latency_ms: i.latencyMs === undefined || i.latencyMs === null ? null : Math.round(i.latencyMs),
    cost_usd: i.costUsd,
    ref_table: i.ref?.table ?? null,
    ref_id: i.ref?.id ?? null,
    student_ref: studentRef,
  };
}

/** Bellek içi defter (testler, OGRENMEN_LLM=fake ile yerel geliştirme). */
export class InMemoryLedger implements LedgerWriter {
  readonly rows: (LedgerRow & { id: number })[] = [];
  async write(row: LedgerRow): Promise<number> {
    const id = this.rows.length + 1;
    this.rows.push({ ...row, id });
    return id;
  }
}

/** Defteri yok sayan yazıcı (yalnız açıkça istenirse). */
export const NULL_LEDGER: LedgerWriter = { write: async () => null };

/** `pg.Pool` ya da `pg.Client` ile uyumlu en dar arayüz. */
export interface PgQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

/** `llm_calls` sütunları (stop_reason hariç: tabloda sütunu yok; durum `status`/`error_code`'da). */
const COLUMNS = [
  'route',
  'purpose',
  'provider',
  'model',
  'effort',
  'prompt_version',
  'tokens_in',
  'tokens_out',
  'cache_read_tokens',
  'cache_write_tokens',
  'images',
  'batch',
  'status',
  'error_code',
  'latency_ms',
  'cost_usd',
  'ref_table',
  'ref_id',
  'student_ref',
] as const satisfies readonly (keyof LedgerRow)[];

export const LEDGER_INSERT_SQL = `insert into public.llm_calls (${COLUMNS.join(', ')}) values (${COLUMNS.map(
  (_, i) => `$${i + 1}`,
).join(', ')}) returning id`;

/** Postgres yazıcı (apps/worker service_role bağlantısı). Yazma hatası çağrıyı düşürmez; `onError`'a gider. */
export class PgLedger implements LedgerWriter {
  constructor(
    private readonly db: PgQueryable,
    private readonly onError: (err: unknown, row: LedgerRow) => void = (err) => {
      console.error('OGR-LLM-009 llm_calls yazılamadı', err);
    },
  ) {}

  async write(row: LedgerRow): Promise<number | null> {
    // max_tokens/refusal gibi durumlarda error_code boşsa stop_reason'ı yaz (tabloda ayrı sütun yok).
    const r = { ...row, error_code: row.error_code ?? (row.status !== 'ok' ? row.stop_reason : null) };
    try {
      const res = await this.db.query(
        LEDGER_INSERT_SQL,
        COLUMNS.map((c) => r[c]),
      );
      const id = res.rows[0]?.id;
      return id === undefined || id === null ? null : Number(id);
    } catch (err) {
      this.onError(err, row);
      return null;
    }
  }
}
