/**
 * Claude hafıza aracı (`memory_20250818`) işleyicileri: view / create / str_replace / insert / delete / rename
 * (PLAN-v2 §3.2). Öğrenci başına dosyalar `public.memory_files` (+ `memory_file_versions`) tablosunda durur.
 *
 * Sınırlar (model çıktısı güvenilmez girdidir):
 *   - dosya yolu DB'deki `app.memory_path_ok` ile aynı izin listesinde: `/memories/` altında, en çok 2 alt dizin,
 *     parçalar [A-Za-z0-9_-] (dosya adında nokta olabilir), uzantı `.md` | `.txt`; `..`, `//`, `%`, ters eğik çizgi yok.
 *     Dizin yolları (`/memories/courses`) yalnız `view` ve `delete` için kabul edilir.
 *   - öğrenci başına ≤ 12 dosya, dosya ≤ 8 KB (UTF-8 bayt)
 *   - `/memories/parent_summary.md` veliye açıktır (RLS memory_files_select): yalnız gece işi (`actor: 'memory-compact'`)
 *     yazar, ≤ 1.5 KB. Koç sohbeti bu dosyaya yazamaz; yoksa sohbet içeriği veliye sızar (OGR-MEM-007).
 *   - her değişiklik bir sürüm satırı yazar (op, actor)
 * Hatalar `MemoryError` olarak fırlatılır; geçit bunu `is_error: true` araç sonucuna çevirir.
 *
 * Depolar: `PgStore` (apps/worker, service_role `pg` havuzu) ve `RpcMemoryStore` (apps/web, kullanıcı JWT'li Supabase
 * istemcisi). İkisi de yazımı `public.upsert_memory_file` RPC'si üzerinden yapar; kilit, sınırlar ve sürümleme DB'de tek yolda kalır.
 */
import { betaMemoryTool, type MemoryToolHandlers } from '@anthropic-ai/sdk/helpers/beta/memory';
import type { BetaMemoryTool20250818Command } from '@anthropic-ai/sdk/resources/beta/messages/messages';

export const MEMORY_ROOT = '/memories';
export const MEMORY_MAX_FILES = 12;
export const MEMORY_MAX_BYTES = 8 * 1024;
export const MEMORY_MAX_PATH = 200;
/** Veliye açık özet dosyası (PLAN-v2 §3.2): yalnız gece işi yazar. */
export const PARENT_SUMMARY_PATH = '/memories/parent_summary.md';
export const PARENT_SUMMARY_MAX_BYTES = 1536;
/** Gece sıkıştırma işinin `actor` değeri; `parent_summary.md`'yi yalnız bu yazar. */
export const MEMORY_COMPACT_ACTOR = 'memory-compact';

/** Dosya yolu: supabase/migrations/0017_rpc.sql `app.memory_path_ok` ile aynı desen. */
const FILE_PATH_RE = /^\/memories\/([A-Za-z0-9_-]+\/){0,2}[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(md|txt)$/;
/** Dizin yolu (yalnız view/delete): en çok 2 düzey. */
const DIR_PATH_RE = /^\/memories(\/[A-Za-z0-9_-]+){1,2}$/;

export class MemoryError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code} ${message}`);
    this.name = 'MemoryError';
    this.code = code;
  }
}

export type MemoryOp = 'create' | 'str_replace' | 'insert' | 'delete' | 'rename' | 'compact';

export interface MemoryFileMeta {
  path: string;
  bytes: number;
  updatedAt: string;
}

/** Depolama arayüzü (öğrenci başına). Sınır denetimleri işleyicidedir; depo yalnız saklar ve sürümler. */
export interface MemoryStore {
  list(studentId: string): Promise<MemoryFileMeta[]>;
  read(studentId: string, path: string): Promise<string | null>;
  /** Oluşturur ya da üzerine yazar; sürüm satırı ekler. */
  write(studentId: string, path: string, content: string, op: MemoryOp, actor: string): Promise<void>;
  remove(studentId: string, path: string, actor: string): Promise<void>;
  rename(studentId: string, oldPath: string, newPath: string, actor: string): Promise<void>;
}

export function utf8Bytes(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/**
 * Yol doğrulaması; geçersizse `MemoryError`. `allowRoot`: `/memories` kökü (view); `allowDir`: dizin yolu (view/delete).
 */
export function assertMemoryPath(path: unknown, opts: { allowRoot?: boolean; allowDir?: boolean } = {}): string {
  if (typeof path !== 'string') throw new MemoryError('OGR-MEM-010', 'yol metin olmalı');
  const p = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  if (opts.allowRoot && p === MEMORY_ROOT) return p;
  if (p.length > MEMORY_MAX_PATH) throw new MemoryError('OGR-MEM-011', `yol en çok ${MEMORY_MAX_PATH} karakter`);
  if (p.includes('..') || p.split('/').some((seg) => seg === '.')) throw new MemoryError('OGR-MEM-013', `yolda '..' ya da '.' olamaz: ${p}`);
  if (p.includes('//')) throw new MemoryError('OGR-MEM-014', `yolda boş bölüm olamaz: ${p}`);
  if (FILE_PATH_RE.test(p)) return p;
  if (opts.allowDir && DIR_PATH_RE.test(p)) return p;
  throw new MemoryError(
    'OGR-MEM-012',
    `yol /memories/ altında, en çok 2 alt dizinde, [A-Za-z0-9_.-] karakterleriyle ve .md ya da .txt uzantılı olmalı: ${p}`,
  );
}

function numbered(content: string, range?: readonly number[]): string {
  const lines = content.split('\n');
  let start = 1;
  let end = lines.length;
  if (range && range.length >= 1) {
    start = Math.max(1, Math.trunc(range[0] ?? 1));
    const e = range[1] === undefined ? lines.length : Math.trunc(range[1]);
    end = e === -1 ? lines.length : Math.min(lines.length, e);
    if (start > lines.length || end < start) throw new MemoryError('OGR-MEM-015', `geçersiz view_range: [${range.join(', ')}]`);
  }
  return lines
    .slice(start - 1, end)
    .map((l, i) => `${String(start + i).padStart(6, ' ')}\t${l}`)
    .join('\n');
}

export interface MemoryHandlerOptions {
  store: MemoryStore;
  studentId: string;
  /** Sürüm satırındaki yazan: 'coach' | 'memory-delta' | 'memory-compact' | 'student:<uuid>' | 'instructor:<uuid>'. */
  actor: string;
  /** Salt okunur (veli/rapor bağlamı): yazma komutları reddedilir. */
  readOnly?: boolean;
  /**
   * `parent_summary.md`'ye yazma izni. Verilmezse yalnız `actor === 'memory-compact'` (gece işi) için açıktır;
   * koç ve öğrenci/eğitmen bağlamlarında her yazma komutu OGR-MEM-007 ile reddedilir.
   */
  allowParentSummary?: boolean;
  maxFiles?: number;
  maxBytes?: number;
}

/**
 * Hafıza aracı işleyicileri (SDK `MemoryToolHandlers` sözleşmesi). Dönen metinler modele gider.
 */
export function createMemoryHandlers(opts: MemoryHandlerOptions): MemoryToolHandlers {
  const { store, studentId, actor } = opts;
  const maxFiles = opts.maxFiles ?? MEMORY_MAX_FILES;
  const maxBytes = opts.maxBytes ?? MEMORY_MAX_BYTES;
  const sized = (content: string) => {
    const n = utf8Bytes(content);
    if (n > maxBytes) throw new MemoryError('OGR-MEM-002', `dosya ${n} bayt; sınır ${maxBytes} bayt`);
  };
  const parentSummaryOk = opts.allowParentSummary ?? actor === MEMORY_COMPACT_ACTOR;
  const writable = (...paths: string[]) => {
    if (opts.readOnly) throw new MemoryError('OGR-MEM-016', 'bu bağlamda hafıza salt okunur');
    if (!parentSummaryOk && paths.includes(PARENT_SUMMARY_PATH)) {
      throw new MemoryError('OGR-MEM-007', `${PARENT_SUMMARY_PATH} yalnız gece işi tarafından yazılır; bu dosyaya yazma`);
    }
  };
  /** Boyut sınırı; `parent_summary.md` için ayrıca ≤ 1.5 KB. */
  const sizedFor = (path: string, content: string) => {
    sized(content);
    const n = utf8Bytes(content);
    if (path === PARENT_SUMMARY_PATH && n > PARENT_SUMMARY_MAX_BYTES) {
      throw new MemoryError('OGR-MEM-007', `${PARENT_SUMMARY_PATH} ${n} bayt; sınır ${PARENT_SUMMARY_MAX_BYTES} bayt`);
    }
  };
  const mustRead = async (path: string): Promise<string> => {
    const c = await store.read(studentId, path);
    if (c === null) throw new MemoryError('OGR-MEM-017', `dosya yok: ${path}`);
    return c;
  };
  const isDir = async (path: string): Promise<boolean> => {
    const files = await store.list(studentId);
    return files.some((f) => f.path.startsWith(`${path}/`));
  };

  return {
    async view(cmd) {
      const path = assertMemoryPath(cmd.path, { allowRoot: true, allowDir: true });
      const content = path === MEMORY_ROOT ? null : await store.read(studentId, path);
      if (content !== null) return `Here's the content of ${path} with line numbers:\n${numbered(content, cmd.view_range)}`;
      const files = (await store.list(studentId)).filter((f) => path === MEMORY_ROOT || f.path.startsWith(`${path}/`));
      if (files.length === 0 && path !== MEMORY_ROOT) throw new MemoryError('OGR-MEM-017', `dosya ya da dizin yok: ${path}`);
      const lines = files
        .sort((a, b) => (a.path < b.path ? -1 : 1))
        .map((f) => `${f.bytes}\t${f.path}`);
      return `Directory ${path} (${files.length}/${maxFiles} files, max ${maxBytes} bytes each):\n${lines.join('\n')}`;
    },

    async create(cmd) {
      const path = assertMemoryPath(cmd.path);
      writable(path);
      if (typeof cmd.file_text !== 'string') throw new MemoryError('OGR-MEM-018', 'file_text metin olmalı');
      sizedFor(path, cmd.file_text);
      const files = await store.list(studentId);
      const exists = files.some((f) => f.path === path);
      if (!exists && files.some((f) => f.path.startsWith(`${path}/`))) throw new MemoryError('OGR-MEM-019', `bu yol bir dizin: ${path}`);
      if (!exists && files.length >= maxFiles) throw new MemoryError('OGR-MEM-001', `dosya sınırı (${maxFiles}) dolu; önce birleştir ya da sil`);
      await store.write(studentId, path, cmd.file_text, 'create', actor);
      return exists ? `File ${path} overwritten.` : `File created successfully at: ${path}`;
    },

    async str_replace(cmd) {
      const path = assertMemoryPath(cmd.path);
      writable(path);
      const content = await mustRead(path);
      if (typeof cmd.old_str !== 'string' || cmd.old_str === '') throw new MemoryError('OGR-MEM-020', 'old_str boş olamaz');
      const first = content.indexOf(cmd.old_str);
      if (first === -1) throw new MemoryError('OGR-MEM-021', `old_str dosyada yok: ${path}`);
      if (content.indexOf(cmd.old_str, first + 1) !== -1) throw new MemoryError('OGR-MEM-022', `old_str birden çok kez geçiyor: ${path}`);
      const next = content.slice(0, first) + (cmd.new_str ?? '') + content.slice(first + cmd.old_str.length);
      sizedFor(path, next);
      await store.write(studentId, path, next, 'str_replace', actor);
      return `The memory file ${path} has been edited.`;
    },

    async insert(cmd) {
      const path = assertMemoryPath(cmd.path);
      writable(path);
      const content = await mustRead(path);
      const lines = content === '' ? [] : content.split('\n');
      const at = cmd.insert_line;
      if (!Number.isInteger(at) || at < 0 || at > lines.length) {
        throw new MemoryError('OGR-MEM-023', `insert_line 0..${lines.length} aralığında olmalı: ${at}`);
      }
      if (typeof cmd.insert_text !== 'string') throw new MemoryError('OGR-MEM-018', 'insert_text metin olmalı');
      const ins = cmd.insert_text.endsWith('\n') ? cmd.insert_text.slice(0, -1).split('\n') : cmd.insert_text.split('\n');
      const next = [...lines.slice(0, at), ...ins, ...lines.slice(at)].join('\n');
      sizedFor(path, next);
      await store.write(studentId, path, next, 'insert', actor);
      return `The memory file ${path} has been edited (inserted after line ${at}).`;
    },

    async delete(cmd) {
      const path = assertMemoryPath(cmd.path, { allowDir: true });
      writable(path);
      if (await store.read(studentId, path) !== null) {
        await store.remove(studentId, path, actor);
        return `File deleted: ${path}`;
      }
      if (await isDir(path)) {
        const files = (await store.list(studentId)).filter((f) => f.path.startsWith(`${path}/`));
        for (const f of files) await store.remove(studentId, f.path, actor);
        return `Directory deleted: ${path} (${files.length} files)`;
      }
      throw new MemoryError('OGR-MEM-017', `dosya ya da dizin yok: ${path}`);
    },

    async rename(cmd) {
      const from = assertMemoryPath(cmd.old_path);
      const to = assertMemoryPath(cmd.new_path);
      writable(from, to);
      if (from === to) throw new MemoryError('OGR-MEM-024', 'eski ve yeni yol aynı');
      const moved = await store.read(studentId, from);
      if (moved === null) throw new MemoryError('OGR-MEM-017', `dosya yok: ${from}`);
      sizedFor(to, moved);
      if (await store.read(studentId, to) !== null || (await isDir(to))) throw new MemoryError('OGR-MEM-025', `hedef zaten var: ${to}`);
      await store.rename(studentId, from, to, actor);
      return `Renamed ${from} to ${to}.`;
    },
  };
}

/** SDK araç nesnesi (`type:"memory_20250818"`, `run` + `parse`) — geçidin araç döngüsünde kullanılır. */
export function memoryTool(opts: MemoryHandlerOptions) {
  return betaMemoryTool(createMemoryHandlers(opts));
}

/** Tek komutu çalıştırır (geçit araç döngüsü ve testler). */
export async function runMemoryCommand(handlers: MemoryToolHandlers, cmd: BetaMemoryTool20250818Command): Promise<string> {
  const h = handlers[cmd.command] as ((c: BetaMemoryTool20250818Command) => Promise<unknown> | unknown) | undefined;
  if (!h) throw new MemoryError('OGR-MEM-026', `bilinmeyen komut: ${String((cmd as { command?: unknown }).command)}`);
  const out = await h.call(handlers, cmd);
  return typeof out === 'string' ? out : JSON.stringify(out);
}

/** Bellek içi depo (testler, yerel geliştirme). Sürümleri de tutar. */
export class InMemoryStore implements MemoryStore {
  readonly files = new Map<string, Map<string, { content: string; updatedAt: string }>>();
  readonly versions: { studentId: string; path: string; version: number; op: MemoryOp; actor: string; content: string | null }[] = [];
  constructor(private readonly clock: () => Date = () => new Date()) {}

  private bucket(studentId: string) {
    let b = this.files.get(studentId);
    if (!b) {
      b = new Map();
      this.files.set(studentId, b);
    }
    return b;
  }
  private nextVersion(studentId: string, path: string): number {
    return this.versions.filter((v) => v.studentId === studentId && v.path === path).reduce((m, v) => Math.max(m, v.version), 0) + 1;
  }

  async list(studentId: string): Promise<MemoryFileMeta[]> {
    return [...this.bucket(studentId).entries()]
      .map(([path, f]) => ({ path, bytes: utf8Bytes(f.content), updatedAt: f.updatedAt }))
      .sort((a, b) => (a.path < b.path ? -1 : 1));
  }
  async read(studentId: string, path: string): Promise<string | null> {
    return this.bucket(studentId).get(path)?.content ?? null;
  }
  async write(studentId: string, path: string, content: string, op: MemoryOp, actor: string): Promise<void> {
    this.bucket(studentId).set(path, { content, updatedAt: this.clock().toISOString() });
    this.versions.push({ studentId, path, version: this.nextVersion(studentId, path), op, actor, content });
  }
  async remove(studentId: string, path: string, actor: string): Promise<void> {
    this.bucket(studentId).delete(path);
    this.versions.push({ studentId, path, version: this.nextVersion(studentId, path), op: 'delete', actor, content: null });
  }
  async rename(studentId: string, oldPath: string, newPath: string, actor: string): Promise<void> {
    const b = this.bucket(studentId);
    const f = b.get(oldPath);
    if (!f) return;
    b.delete(oldPath);
    b.set(newPath, { content: f.content, updatedAt: this.clock().toISOString() });
    this.versions.push({ studentId, path: newPath, version: this.nextVersion(studentId, newPath), op: 'rename', actor, content: f.content });
  }
}

/** DB hatasını (`OGR-MEM-00x …` iletili) `MemoryError`'a çevirir; model `is_error` sonucunda kodu görür. */
export function toMemoryError(err: unknown): unknown {
  if (err instanceof MemoryError) return err;
  const message = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : String(err);
  const m = /OGR-MEM-\d{3}/.exec(message);
  if (!m) return err;
  return new MemoryError(m[0], message.slice(message.indexOf(m[0]) + m[0].length).trim());
}

/** `public.upsert_memory_file` argümanları (supabase/migrations/0017_rpc.sql). */
export interface UpsertMemoryFileArgs {
  p_student: string;
  p_path: string;
  p_content: string | null;
  p_op: MemoryOp;
  p_actor: string;
  p_new_path: string | null;
}

export const UPSERT_MEMORY_FILE_SQL =
  'select public.upsert_memory_file($1::uuid, $2, $3, $4, $5, $6) as result';

/** `pg` istemcisi için en dar arayüz. */
export interface PgQueryLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}
/** `pg.Pool` ile uyumlu (yalnız `query` kullanılır). */
export type PgPoolLike = PgQueryLike;

/**
 * Depo düzeyi `parent_summary.md` koruması (işleyiciden bağımsız ikinci kat): yalnız `memory-compact` yazar,
 * içerik ≤ 1.5 KB. service_role bağlantısında RPC bu kuralı uygulamadığı için `PgStore` bunu kendisi denetler.
 */
export function assertParentSummaryWrite(paths: readonly (string | null)[], actor: string, content: string | null): void {
  if (!paths.includes(PARENT_SUMMARY_PATH)) return;
  if (actor !== MEMORY_COMPACT_ACTOR) {
    throw new MemoryError('OGR-MEM-007', `${PARENT_SUMMARY_PATH} yalnız gece işi (${MEMORY_COMPACT_ACTOR}) tarafından yazılır`);
  }
  if (content !== null && utf8Bytes(content) > PARENT_SUMMARY_MAX_BYTES) {
    throw new MemoryError('OGR-MEM-007', `${PARENT_SUMMARY_PATH} ${utf8Bytes(content)} bayt; sınır ${PARENT_SUMMARY_MAX_BYTES} bayt`);
  }
}

/**
 * Postgres deposu (apps/worker, service_role `pg` havuzu). Okuma doğrudan `select`; her yazım (create/str_replace/
 * insert/compact/delete/rename) tek bir `public.upsert_memory_file` çağrısıdır: öğrenci kilidi, yol izin listesi,
 * 8 KB, ≤ 12 dosya ve sürüm satırı DB'de tek işlemde. service_role güvenilir sayıldığından RPC'deki
 * `parent_summary.md` koruması (OGR-MEM-007) burada devreye girmez; o kural `createMemoryHandlers`'ta uygulanır.
 */
export class PgStore implements MemoryStore {
  constructor(private readonly db: PgQueryLike) {}

  async list(studentId: string): Promise<MemoryFileMeta[]> {
    const r = await this.db.query(
      'select path, bytes, updated_at from public.memory_files where student_id = $1 order by path',
      [studentId],
    );
    return r.rows.map(toMeta);
  }

  async read(studentId: string, path: string): Promise<string | null> {
    const r = await this.db.query('select content from public.memory_files where student_id = $1 and path = $2', [studentId, path]);
    const row = r.rows[0];
    return row ? String(row.content) : null;
  }

  private async upsert(a: UpsertMemoryFileArgs): Promise<void> {
    assertParentSummaryWrite([a.p_path, a.p_new_path], a.p_actor, a.p_content);
    try {
      await this.db.query(UPSERT_MEMORY_FILE_SQL, [a.p_student, a.p_path, a.p_content, a.p_op, a.p_actor, a.p_new_path]);
    } catch (err) {
      throw toMemoryError(err);
    }
  }

  write(studentId: string, path: string, content: string, op: MemoryOp, actor: string): Promise<void> {
    return this.upsert({ p_student: studentId, p_path: path, p_content: content, p_op: op, p_actor: actor, p_new_path: null });
  }

  remove(studentId: string, path: string, actor: string): Promise<void> {
    return this.upsert({ p_student: studentId, p_path: path, p_content: null, p_op: 'delete', p_actor: actor, p_new_path: null });
  }

  rename(studentId: string, oldPath: string, newPath: string, actor: string): Promise<void> {
    return this.upsert({ p_student: studentId, p_path: oldPath, p_content: null, p_op: 'rename', p_actor: actor, p_new_path: newPath });
  }
}

function toMeta(row: Record<string, unknown>): MemoryFileMeta {
  return {
    path: String(row.path),
    bytes: Number(row.bytes),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/** PostgREST yanıtı (`{ data, error }`); supabase-js sorgu kurucuları bunu `await` ile verir. */
export interface PostgrestResultLike<T> {
  data: T | null;
  error: { message: string; code?: string } | null;
}

/** supabase-js `from(...).select(...)` zincirinin kullanılan dar parçası. */
export interface SelectQueryLike<T = Record<string, unknown>[]> extends PromiseLike<PostgrestResultLike<T>> {
  eq(column: string, value: unknown): SelectQueryLike<T>;
  order(column: string, opts?: { ascending?: boolean }): SelectQueryLike<T>;
}

/** supabase-js istemcisinin kullanılan dar parçası (`rpc` + `from().select()`). */
export interface SupabaseLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<PostgrestResultLike<unknown>>;
  from(table: string): { select(columns: string): SelectQueryLike };
}

/**
 * Supabase deposu (apps/web route handler'ları, kullanıcı JWT'si). Okuma RLS'li `select` (memory_files_select),
 * yazım `public.upsert_memory_file` RPC'si: DB öğrenci erişimini (`assert_student_access`), yol/boyut/dosya sınırlarını
 * ve `parent_summary.md` korumasını (OGR-MEM-007) burada da uygular.
 */
export class RpcMemoryStore implements MemoryStore {
  constructor(private readonly client: SupabaseLike) {}

  private static fail(error: { message: string }): never {
    throw toMemoryError(new Error(error.message));
  }

  async list(studentId: string): Promise<MemoryFileMeta[]> {
    const { data, error } = await this.client
      .from('memory_files')
      .select('path, bytes, updated_at')
      .eq('student_id', studentId)
      .order('path', { ascending: true });
    if (error) RpcMemoryStore.fail(error);
    return (data ?? []).map(toMeta);
  }

  async read(studentId: string, path: string): Promise<string | null> {
    const { data, error } = await this.client.from('memory_files').select('content').eq('student_id', studentId).eq('path', path);
    if (error) RpcMemoryStore.fail(error);
    const row = data?.[0];
    return row ? String(row.content) : null;
  }

  private async upsert(a: UpsertMemoryFileArgs): Promise<void> {
    const { error } = await this.client.rpc('upsert_memory_file', { ...a });
    if (error) RpcMemoryStore.fail(error);
  }

  write(studentId: string, path: string, content: string, op: MemoryOp, actor: string): Promise<void> {
    return this.upsert({ p_student: studentId, p_path: path, p_content: content, p_op: op, p_actor: actor, p_new_path: null });
  }

  remove(studentId: string, path: string, actor: string): Promise<void> {
    return this.upsert({ p_student: studentId, p_path: path, p_content: null, p_op: 'delete', p_actor: actor, p_new_path: null });
  }

  rename(studentId: string, oldPath: string, newPath: string, actor: string): Promise<void> {
    return this.upsert({ p_student: studentId, p_path: oldPath, p_content: null, p_op: 'rename', p_actor: actor, p_new_path: newPath });
  }
}
