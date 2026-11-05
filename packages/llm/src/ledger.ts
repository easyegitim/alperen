/**
 * Çağrı defteri: her API isteği (onarım turu ve yeniden deneme dahil) bir `public.llm_calls` satırı yazar
 * (supabase/migrations/0014_llm_ledger.sql). Öğrenci yalnız `students.public_ref` ile taşınır; uuid ya da ad asla.
 * Yazıcılar:
 *   - `PgLedger`: `pg` ile doğrudan insert (apps/worker, service_role bağlantısı).
 *   - `RpcLedger`: `public.log_llm_call(jsonb)` RPC'si (supabase-js `rpc`). apps/web route handler'ları bunu
 *     KULLANICININ JWT'li istemcisiyle kullanır; service_role yalnız apps/worker'dadır, web asla kullanmaz
 *     (PLAN-v2 §4, PLAN-v2-detail §2.4). Sözleşme (DB tarafı, `log_llm_call`): authenticated çağıran yalnız
 *     `WEB_LEDGER_ROUTES` rotalarını yazabilir; gönderilen `student_ref` yok sayılır ve oturumdan
 *     (`app.my_student_id()` / rol) türetilir; `cost_usd` çağrı başına üst sınırla kısılır. `llm_calls` tablosunda
 *     authenticated için doğrudan insert politikası yoktur; tek yol bu RPC'dir.
 *   - `InMemoryLedger`: yalnız testler ve `OGRENMEN_LLM=fake` yerel geliştirme (geçit gerçek taşımada bunu kabul etmez).
 */
import { StudentRefError, type LedgerStatus } from './errors.js';
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

/** Defterde geçersiz `student_ref` yerine yazılan hata kodu (satır `student_ref = null` ile yine yazılır). */
export const BAD_STUDENT_REF = 'bad_student_ref';

/**
 * `student_ref` doğrulaması: null ya da `students.public_ref` (`s_` + küçük harf/rakam). Geçit bunu API isteğinden
 * ÖNCE çağırır; böylece geçersiz kimlik ücretli bir isteğe ve kayıp yanıta yol açmaz.
 */
export function assertStudentRef(ref: string | null | undefined): asserts ref is string | null | undefined {
  if (ref === null || ref === undefined) return;
  if (typeof ref !== 'string' || UUID.test(ref) || !PUBLIC_REF.test(ref)) throw new StudentRefError(String(ref));
}

/** Defter satırı kurar; `student_ref` uuid gibi görünürse reddeder (yalnız public_ref). */
export function buildLedgerRow(i: LedgerRowInput): LedgerRow {
  const studentRef = i.studentRef ?? null;
  assertStudentRef(studentRef);
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

/** `llm_calls` sütunlarındaki kayıt (stop_reason yok). */
export type LedgerRecord = { [K in (typeof COLUMNS)[number]]: LedgerRow[K] };

/**
 * Satırı tablo sütunlarına indirger. max_tokens/refusal gibi durumlarda `error_code` boşsa `stop_reason` yazılır
 * (tabloda ayrı sütun yok).
 */
export function toLedgerRecord(row: LedgerRow): LedgerRecord {
  const r = { ...row, error_code: row.error_code ?? (row.status !== 'ok' ? row.stop_reason : null) };
  return Object.fromEntries(COLUMNS.map((c) => [c, r[c]])) as LedgerRecord;
}

const defaultOnError = (err: unknown) => {
  console.error('OGR-LLM-009 llm_calls yazılamadı', err);
};

/** Postgres yazıcı (apps/worker service_role bağlantısı). Yazma hatası çağrıyı düşürmez; `onError`'a gider. */
export class PgLedger implements LedgerWriter {
  constructor(
    private readonly db: PgQueryable,
    private readonly onError: (err: unknown, row: LedgerRow) => void = defaultOnError,
  ) {}

  async write(row: LedgerRow): Promise<number | null> {
    const r = toLedgerRecord(row);
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

/**
 * apps/web'in kullanıcı JWT'siyle çağırdığı (ve `log_llm_call`'ın authenticated çağırana izin verdiği) rotalar.
 * Diğer bütün rotalar apps/worker'da `PgLedger` ile koşar.
 */
export const WEB_LEDGER_ROUTES = ['coach_chat', 'coach_deep', 'parent_chat'] as const;

/** supabase-js istemcisinin `rpc` parçası. */
export interface RpcClientLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

/**
 * RPC yazıcı: `supabase.rpc('log_llm_call', { p_call: row })` (supabase/migrations/0017_rpc.sql). Tetikleyici
 * `spend_ledger`'ı günceller. apps/web'de kullanıcının JWT'li sunucu istemcisi verilir (service_role değil); RPC
 * authenticated çağıranı `WEB_LEDGER_ROUTES` ile sınırlar, `student_ref`'i oturumdan türetir. Yazma hatası çağrıyı
 * düşürmez; `onError`'a gider.
 */
export class RpcLedger implements LedgerWriter {
  constructor(
    private readonly client: RpcClientLike,
    private readonly onError: (err: unknown, row: LedgerRow) => void = defaultOnError,
  ) {}

  async write(row: LedgerRow): Promise<number | null> {
    try {
      const { data, error } = await this.client.rpc('log_llm_call', { p_call: toLedgerRecord(row) });
      if (error) throw new Error(error.message);
      return data === null || data === undefined ? null : Number(data);
    } catch (err) {
      this.onError(err, row);
      return null;
    }
  }
}
