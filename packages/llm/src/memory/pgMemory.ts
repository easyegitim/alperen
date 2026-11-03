/**
 * Claude hafıza aracı (`memory_20250818`) işleyicileri: view / create / str_replace / insert / delete / rename
 * (PLAN-v2 §3.2). Öğrenci başına dosyalar `public.memory_files` (+ `memory_file_versions`) tablosunda durur.
 *
 * Sınırlar (model çıktısı güvenilmez girdidir):
 *   - yol yalnız `/memories/` altında; `..`, `//`, ters eğik çizgi, denetim karakteri, `%` yok;
 *     karakter kümesi DB denetimiyle aynı: [A-Za-z0-9_./-]
 *   - öğrenci başına ≤ 12 dosya, dosya ≤ 8 KB (UTF-8 bayt)
 *   - her değişiklik bir sürüm satırı yazar (op, actor)
 * Hatalar `MemoryError` olarak fırlatılır; geçit bunu `is_error: true` araç sonucuna çevirir.
 */
import { betaMemoryTool, type MemoryToolHandlers } from '@anthropic-ai/sdk/helpers/beta/memory';
import type { BetaMemoryTool20250818Command } from '@anthropic-ai/sdk/resources/beta/messages/messages';

export const MEMORY_ROOT = '/memories';
export const MEMORY_MAX_FILES = 12;
export const MEMORY_MAX_BYTES = 8 * 1024;
export const MEMORY_MAX_PATH = 200;

const PATH_RE = /^\/memories\/[A-Za-z0-9_./-]+$/;

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

/** Yol doğrulaması; geçersizse `MemoryError`. `allowRoot`: yalnız `view` için `/memories` kökü. */
export function assertMemoryPath(path: unknown, opts: { allowRoot?: boolean } = {}): string {
  if (typeof path !== 'string') throw new MemoryError('OGR-MEM-010', 'yol metin olmalı');
  const p = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
  if (opts.allowRoot && p === MEMORY_ROOT) return p;
  if (p.length > MEMORY_MAX_PATH) throw new MemoryError('OGR-MEM-011', `yol en çok ${MEMORY_MAX_PATH} karakter`);
  if (!PATH_RE.test(p)) throw new MemoryError('OGR-MEM-012', `yol /memories/ altında olmalı ve yalnız [A-Za-z0-9_./-] içermeli: ${p}`);
  if (p.split('/').some((seg) => seg === '..' || seg === '.')) throw new MemoryError('OGR-MEM-013', `yolda '..' ya da '.' olamaz: ${p}`);
  if (p.includes('//')) throw new MemoryError('OGR-MEM-014', `yolda boş bölüm olamaz: ${p}`);
  return p;
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
  const writable = () => {
    if (opts.readOnly) throw new MemoryError('OGR-MEM-016', 'bu bağlamda hafıza salt okunur');
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
      const path = assertMemoryPath(cmd.path, { allowRoot: true });
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
      writable();
      const path = assertMemoryPath(cmd.path);
      if (typeof cmd.file_text !== 'string') throw new MemoryError('OGR-MEM-018', 'file_text metin olmalı');
      sized(cmd.file_text);
      const files = await store.list(studentId);
      const exists = files.some((f) => f.path === path);
      if (!exists && files.some((f) => f.path.startsWith(`${path}/`))) throw new MemoryError('OGR-MEM-019', `bu yol bir dizin: ${path}`);
      if (!exists && files.length >= maxFiles) throw new MemoryError('OGR-MEM-001', `dosya sınırı (${maxFiles}) dolu; önce birleştir ya da sil`);
      await store.write(studentId, path, cmd.file_text, 'create', actor);
      return exists ? `File ${path} overwritten.` : `File created successfully at: ${path}`;
    },

    async str_replace(cmd) {
      writable();
      const path = assertMemoryPath(cmd.path);
      const content = await mustRead(path);
      if (typeof cmd.old_str !== 'string' || cmd.old_str === '') throw new MemoryError('OGR-MEM-020', 'old_str boş olamaz');
      const first = content.indexOf(cmd.old_str);
      if (first === -1) throw new MemoryError('OGR-MEM-021', `old_str dosyada yok: ${path}`);
      if (content.indexOf(cmd.old_str, first + 1) !== -1) throw new MemoryError('OGR-MEM-022', `old_str birden çok kez geçiyor: ${path}`);
      const next = content.slice(0, first) + (cmd.new_str ?? '') + content.slice(first + cmd.old_str.length);
      sized(next);
      await store.write(studentId, path, next, 'str_replace', actor);
      return `The memory file ${path} has been edited.`;
    },

    async insert(cmd) {
      writable();
      const path = assertMemoryPath(cmd.path);
      const content = await mustRead(path);
      const lines = content === '' ? [] : content.split('\n');
      const at = cmd.insert_line;
      if (!Number.isInteger(at) || at < 0 || at > lines.length) {
        throw new MemoryError('OGR-MEM-023', `insert_line 0..${lines.length} aralığında olmalı: ${at}`);
      }
      if (typeof cmd.insert_text !== 'string') throw new MemoryError('OGR-MEM-018', 'insert_text metin olmalı');
      const ins = cmd.insert_text.endsWith('\n') ? cmd.insert_text.slice(0, -1).split('\n') : cmd.insert_text.split('\n');
      const next = [...lines.slice(0, at), ...ins, ...lines.slice(at)].join('\n');
      sized(next);
      await store.write(studentId, path, next, 'insert', actor);
      return `The memory file ${path} has been edited (inserted after line ${at}).`;
    },

    async delete(cmd) {
      writable();
      const path = assertMemoryPath(cmd.path);
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
      writable();
      const from = assertMemoryPath(cmd.old_path);
      const to = assertMemoryPath(cmd.new_path);
      if (from === to) throw new MemoryError('OGR-MEM-024', 'eski ve yeni yol aynı');
      if (await store.read(studentId, from) === null) throw new MemoryError('OGR-MEM-017', `dosya yok: ${from}`);
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

/** `pg` istemcisi (havuzdan alınan) için en dar arayüz. */
export interface PgClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
  release(): void;
}
export interface PgPoolLike {
  connect(): Promise<PgClientLike>;
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

/**
 * Postgres deposu: `public.memory_files` + `public.memory_file_versions` (supabase/migrations/0007_*).
 * apps/worker service_role bağlantısıyla kullanılır (RLS atlanır); her yazım tek işlemde dosya + sürüm satırı yazar.
 * DB tarafı da yolu, 8 KB'ı (check) ve dosya sayısını (tetikleyici, OGR-MEM-001) ayrıca denetler.
 */
export class PgStore implements MemoryStore {
  constructor(private readonly pool: PgPoolLike) {}

  async list(studentId: string): Promise<MemoryFileMeta[]> {
    const r = await this.pool.query(
      'select path, bytes, updated_at from public.memory_files where student_id = $1 order by path',
      [studentId],
    );
    return r.rows.map((row) => ({
      path: String(row.path),
      bytes: Number(row.bytes),
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    }));
  }

  async read(studentId: string, path: string): Promise<string | null> {
    const r = await this.pool.query('select content from public.memory_files where student_id = $1 and path = $2', [studentId, path]);
    const row = r.rows[0];
    return row ? String(row.content) : null;
  }

  private async tx<T>(fn: (c: PgClientLike) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const out = await fn(c);
      await c.query('commit');
      return out;
    } catch (err) {
      await c.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }
  }

  private static readonly VERSION_SQL = `insert into public.memory_file_versions (student_id, path, version, op, actor, content)
     select $1, $2, coalesce(max(version), 0) + 1, $3, $4, $5 from public.memory_file_versions where student_id = $1 and path = $2`;

  async write(studentId: string, path: string, content: string, op: MemoryOp, actor: string): Promise<void> {
    await this.tx(async (c) => {
      await c.query(
        `insert into public.memory_files (student_id, path, content) values ($1, $2, $3)
         on conflict (student_id, path) do update set content = excluded.content`,
        [studentId, path, content],
      );
      await c.query(PgStore.VERSION_SQL, [studentId, path, op, actor, content]);
    });
  }

  async remove(studentId: string, path: string, actor: string): Promise<void> {
    await this.tx(async (c) => {
      await c.query('delete from public.memory_files where student_id = $1 and path = $2', [studentId, path]);
      await c.query(PgStore.VERSION_SQL, [studentId, path, 'delete', actor, null]);
    });
  }

  async rename(studentId: string, oldPath: string, newPath: string, actor: string): Promise<void> {
    await this.tx(async (c) => {
      const r = await c.query(
        'update public.memory_files set path = $3 where student_id = $1 and path = $2 returning content',
        [studentId, oldPath, newPath],
      );
      const content = r.rows[0] ? String(r.rows[0].content) : null;
      await c.query(PgStore.VERSION_SQL, [studentId, newPath, 'rename', actor, content]);
    });
  }
}
