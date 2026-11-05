/**
 * Veritabanı köprüsü (apps/worker, service_role): sürüm kaynaklarını okur ve paketteki promptları `prompt_versions`'a yazar.
 * `pg.Pool`/`pg.Client` uyumlu en dar arayüzle çalışır; bu paket `pg`'ye bağlı değildir.
 *
 * RLS: `runtime_flags` ve `prompt_versions` yalnız admin ve service_role okur (0018_rls.sql). apps/web kullanıcı JWT'siyle
 * okuyamaz; web, güvenilir sunucu havuzuyla (OGRENMEN_DATABASE_URL) `createPromptResolver(pool, { ttlMs })` kullanır; sabitleme ve
 * geri alma böylece koç rotasına da ulaşır. Bellek kipinde `sources` verilmez ve kilitteki varsayılan sürüm gelir.
 */
import { allPrompts, loadPrompt } from './index.js';
import type { LoadedPrompt } from './registry.js';
import { VERSION } from './meta.js';
import type { VersionSources } from './select.js';

export interface SqlQueryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

/** `runtime_flags.key`: değeri {rota: sürüm} jsonb nesnesi. */
export const PROMPT_VERSIONS_FLAG = 'prompt_versions';

function versionMap(entries: Iterable<[unknown, unknown]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [route, version] of entries) {
    if (typeof route === 'string' && typeof version === 'string' && VERSION.test(version)) out[route] = version;
  }
  return out;
}

/** Sabitleme (`runtime_flags['prompt_versions']`) ve etkin satırları (`prompt_versions.active`) okur. */
export async function readVersionSources(db: SqlQueryable): Promise<VersionSources> {
  const flag = await db.query('select value from public.runtime_flags where key = $1', [PROMPT_VERSIONS_FLAG]);
  const raw = flag.rows[0]?.value;
  const pinned = raw && typeof raw === 'object' && !Array.isArray(raw) ? versionMap(Object.entries(raw)) : {};
  const active = await db.query('select route, version from public.prompt_versions where active order by route');
  return { pinned, active: versionMap(active.rows.map((r) => [r.route, r.version])) };
}

export interface SyncResult {
  /** Yeni yazılan `rota@sürüm`. */
  inserted: string[];
  /** Zaten aynı metinle var olan. */
  unchanged: string[];
  /** Aynı rota/sürüm farklı metinle var: sürüm değişmez olmalı, yeni sürüm açılmalı. Satıra dokunulmaz. */
  drifted: string[];
}

/**
 * Paketteki her rota × sürümü `prompt_versions`'a ekler (`active = false`; etkinleştirme eval kapısının işidir).
 * Var olan satır güncellenmez: yayımlanmış bir sürümün metni değişmişse `drifted` listesine girer.
 */
export async function syncPromptVersions(db: SqlQueryable, prompts: readonly LoadedPrompt[] = allPrompts()): Promise<SyncResult> {
  const out: SyncResult = { inserted: [], unchanged: [], drifted: [] };
  for (const p of prompts) {
    const id = `${p.meta.route}@${p.meta.version}`;
    const ins = await db.query(
      `insert into public.prompt_versions (route, version, system_text, schema_name, model, effort, active)
       values ($1, $2, $3, $4, $5, $6, false)
       on conflict (route, version) do nothing
       returning id`,
      [p.meta.route, p.meta.version, p.text, p.meta.schema, p.meta.model, p.meta.effort],
    );
    if (ins.rows.length > 0) {
      out.inserted.push(id);
      continue;
    }
    const cur = await db.query(
      'select system_text, schema_name, model, effort from public.prompt_versions where route = $1 and version = $2',
      [p.meta.route, p.meta.version],
    );
    const row = cur.rows[0];
    const same =
      row !== undefined &&
      row.system_text === p.text &&
      (row.schema_name ?? null) === p.meta.schema &&
      row.model === p.meta.model &&
      (row.effort ?? null) === p.meta.effort;
    (same ? out.unchanged : out.drifted).push(id);
  }
  return out;
}

/**
 * Kısa süreli önbellekli çözücü (worker): kaynakları en çok `ttlMs`'de bir okur. Veritabanı hatasında son bilinen
 * kaynaklarla (ilk okumada hiç kaynaksız, yani en yüksek sürümle) devam eder; hata `onError`'a gider.
 */
export function createPromptResolver(
  db: SqlQueryable,
  opts: { ttlMs?: number; now?: () => number; onError?: (err: unknown) => void } = {},
) {
  const ttl = opts.ttlMs ?? 60_000;
  const now = opts.now ?? Date.now;
  let cached: { at: number; sources: VersionSources } | null = null;
  async function sources(): Promise<VersionSources> {
    if (cached && now() - cached.at < ttl) return cached.sources;
    try {
      cached = { at: now(), sources: await readVersionSources(db) };
    } catch (err) {
      opts.onError?.(err);
      cached = { at: now(), sources: cached?.sources ?? {} };
    }
    return cached.sources;
  }
  return {
    sources,
    async load(route: string): Promise<LoadedPrompt> {
      return loadPrompt(route, { sources: await sources() });
    },
    invalidate(): void {
      cached = null;
    },
  };
}
