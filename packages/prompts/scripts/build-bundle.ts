/**
 * Prompt kaynaklarını `src/bundle.gen.ts`'e gömer ve `prompts.lock.json`'ı günceller.
 *
 *   bun scripts/build-bundle.ts            üret (kilitte olan bir sürümün metni değiştiyse düşer)
 *   bun scripts/build-bundle.ts --check    yalnız denetle: gömülü dosya ve kilit diskteki kaynaklarla aynı mı (check.sh)
 *   bun scripts/build-bundle.ts --promote coach_chat=v2   rotanın varsayılan sürümünü bilerek değiştir (eval kapısından sonra)
 *   bun scripts/build-bundle.ts --relock   kilitteki değişmiş/silinmiş girdilerin üzerine bilerek yaz
 *
 * Kilit, yayımlanmış sürümlerin değişmezliğini korur: `coach_chat/v1` metni (katmanları dahil) bir kez kilitlendikten
 * sonra değişirse yeni sürüm (v2) açılır; v1'in eval puanı ve `llm_calls.prompt_version` geçmişi anlamını korur.
 * Her birleşik metin lint kurallarından (src/lint.ts) ve 512 token önbellek eşiğinden geçmelidir.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLintClean } from '../src/lint.js';
import { compareVersions, ROUTE_NAME, VERSION } from '../src/meta.js';
import { MIN_CACHEABLE_TOKENS, PromptRegistry, type LoadedPrompt } from '../src/registry.js';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUNDLE = join(PKG, 'src', 'bundle.gen.ts');
const LOCK = join(PKG, 'prompts.lock.json');
/** Paket kökünde rota dizini olamayacak adlar. */
const NOT_ROUTES = new Set(['src', 'scripts', 'test', 'eval', 'node_modules', 'dist']);

export interface LockEntry {
  sha256: string;
  model: string;
  effort: string;
  schema: string | null;
  tools: string[];
}
export interface LockFile {
  note: string;
  /** Rota başına varsayılan sürüm: yalnız eval kapısı ya da `--promote` değiştirir. */
  defaults: Record<string, string>;
  prompts: Record<string, LockEntry>;
}

function walk(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

/** Diskteki kaynaklar: `<rota>/<vN>.md` ve `layers/**.md` (anahtarlar `/` ile, sıralı). */
export function collectSources(pkg = PKG): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(pkg).sort()) {
    const dir = join(pkg, name);
    if (NOT_ROUTES.has(name) || name.startsWith('.') || !statSync(dir).isDirectory()) continue;
    if (!ROUTE_NAME.test(name)) throw new Error(`rota dizini adı geçersiz: ${name}`);
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith('.md')) continue;
      if (!VERSION.test(f.slice(0, -3))) throw new Error(`${name}/${f}: dosya adı vN.md olmalı`);
      out[`${name}/${f}`] = readFileSync(join(dir, f), 'utf8');
    }
  }
  const layers = join(pkg, 'src', 'layers');
  for (const file of walk(layers)) {
    if (!file.endsWith('.md')) continue;
    out[`layers/${relative(layers, file).split('\\').join('/')}`] = readFileSync(file, 'utf8');
  }
  return out;
}

export function renderBundle(sources: Record<string, string>, defaults: Record<string, string> = {}): string {
  const lines = Object.keys(sources)
    .sort()
    .map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify((sources[k] as string).replace(/\r\n?/g, '\n'))},`);
  return [
    '// Üretilmiş dosya: elle düzenleme. Kaynak: packages/prompts/<rota>/<sürüm>.md ve src/layers/**.md',
    '// Yeniden üret: bun run --cwd packages/prompts bundle (denetim: bundle:check)',
    'export const PROMPT_SOURCES: Readonly<Record<string, string>> = {',
    ...lines,
    '};',
    '',
    '/** Rota başına varsayılan sürüm (prompts.lock.json defaults). Yeni sürüm, terfi edilene dek varsayılan olmaz. */',
    'export const PROMPT_DEFAULTS: Readonly<Record<string, string>> = {',
    ...Object.keys(defaults).sort().map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(defaults[k])},`),
    '};',
    '',
  ].join('\n');
}

function lockEntry(p: LoadedPrompt): LockEntry {
  return { sha256: p.hash, model: p.meta.model, effort: p.meta.effort, schema: p.meta.schema, tools: [...p.meta.tools] };
}

export function renderLock(prompts: readonly LoadedPrompt[], defaults: Record<string, string> = {}): string {
  const entries: Record<string, LockEntry> = {};
  for (const p of [...prompts].sort((a, b) => (`${a.meta.route}@${a.meta.version}` < `${b.meta.route}@${b.meta.version}` ? -1 : 1))) {
    entries[`${p.meta.route}@${p.meta.version}`] = lockEntry(p);
  }
  const lock: LockFile = {
    note: 'Yayımlanmış prompt sürümleri değişmez: metin değişirse yeni sürüm açın (bkz. README). Üreten: scripts/build-bundle.ts',
    defaults: Object.fromEntries(Object.entries(defaults).sort(([a], [b]) => (a < b ? -1 : 1))),
    prompts: entries,
  };
  return `${JSON.stringify(lock, null, 2)}\n`;
}

/** Kaynakları doğrular: ayrıştırma, katmanlar, lint, önbellek eşiği. Hata listesini döndürür. */
export function validate(registry: PromptRegistry): { prompts: LoadedPrompt[]; errors: string[] } {
  const errors: string[] = [];
  let prompts: LoadedPrompt[] = [];
  try {
    prompts = registry.all();
  } catch (err) {
    return { prompts, errors: [String(err instanceof Error ? err.message : err)] };
  }
  const toolNames = [...new Set(prompts.flatMap((p) => p.meta.tools))].sort();
  for (const p of prompts) {
    const id = `${p.meta.route}/${p.meta.version}`;
    try {
      assertLintClean(p.text, id, { toolNames });
    } catch (err) {
      errors.push(String(err instanceof Error ? err.message : err));
    }
    if (p.estimatedTokens < MIN_CACHEABLE_TOKENS) {
      errors.push(`${id}: birleşik metin ~${p.estimatedTokens} token; önbellek için en az ${MIN_CACHEABLE_TOKENS} gerekir`);
    }
  }
  for (const key of registry.layerKeys()) {
    try {
      assertLintClean(registry.layer(key), `layers/${key}`, { toolNames });
    } catch (err) {
      errors.push(String(err instanceof Error ? err.message : err));
    }
  }
  return { prompts, errors };
}

/**
 * Rota varsayılanları: kilitteki değer korunur (yeni sürüm kendiliğinden açılmaz); kilitte olmayan rota için en yüksek
 * sürüm yazılır (ilk yayım). `promote` ({rota: sürüm}) bilerek değiştirir.
 */
export function resolveDefaults(oldLock: LockFile | null, prompts: readonly LoadedPrompt[], promote: Record<string, string> = {}): { defaults: Record<string, string>; errors: string[] } {
  const errors: string[] = [];
  const byRoute = new Map<string, string[]>();
  for (const p of prompts) byRoute.set(p.meta.route, [...(byRoute.get(p.meta.route) ?? []), p.meta.version]);
  const defaults: Record<string, string> = {};
  for (const [route, versions] of byRoute) {
    const sorted = [...versions].sort(compareVersions);
    const old = oldLock?.defaults?.[route];
    defaults[route] = old !== undefined && versions.includes(old) ? old : (sorted[sorted.length - 1] as string);
  }
  for (const [route, version] of Object.entries(promote)) {
    if (!byRoute.get(route)?.includes(version)) errors.push(`--promote ${route}=${version}: böyle bir sürüm yok`);
    else defaults[route] = version;
  }
  return { defaults, errors };
}

/** Kilit karşılaştırması: değişen ya da kaybolan girdiler. */
export function lockConflicts(oldLock: LockFile | null, prompts: readonly LoadedPrompt[]): string[] {
  if (!oldLock) return [];
  const now = new Map(prompts.map((p) => [`${p.meta.route}@${p.meta.version}`, lockEntry(p)]));
  const out: string[] = [];
  for (const [id, entry] of Object.entries(oldLock.prompts)) {
    const cur = now.get(id);
    if (!cur) out.push(`${id}: kilitte var ama kaynaklarda yok (yayımlanmış sürüm silinmez)`);
    else if (JSON.stringify(cur) !== JSON.stringify(entry)) out.push(`${id}: kilitlenmiş sürüm değişti; yeni sürüm açın ya da --relock`);
  }
  return out;
}

function main(argv: string[]): number {
  const check = argv.includes('--check');
  const relock = argv.includes('--relock');
  const promote: Record<string, string> = {};
  argv.forEach((a, i) => {
    if (a !== '--promote') return;
    const [route, version] = (argv[i + 1] ?? '').split('=');
    if (route && version) promote[route] = version;
  });
  const sources = collectSources();
  const { prompts, errors } = validate(new PromptRegistry(sources));
  const oldLock: LockFile | null = existsSync(LOCK) ? (JSON.parse(readFileSync(LOCK, 'utf8')) as LockFile) : null;
  const resolved = resolveDefaults(oldLock, prompts, promote);
  errors.push(...resolved.errors);
  const bundle = renderBundle(sources, resolved.defaults);
  const lock = renderLock(prompts, resolved.defaults);
  if (check) {
    if (!existsSync(BUNDLE) || readFileSync(BUNDLE, 'utf8') !== bundle) errors.push('src/bundle.gen.ts güncel değil: bun run bundle');
    if (!oldLock || readFileSync(LOCK, 'utf8') !== lock) {
      errors.push(...lockConflicts(oldLock, prompts));
      errors.push('prompts.lock.json güncel değil: bun run bundle');
    }
  } else if (!relock) {
    errors.push(...lockConflicts(oldLock, prompts));
  }
  if (errors.length > 0) {
    for (const e of errors) console.error(`HATA: ${e}`);
    return 1;
  }
  if (!check) {
    writeFileSync(BUNDLE, bundle);
    writeFileSync(LOCK, lock);
  }
  const summary = prompts.map((p) => `${p.meta.route}@${p.meta.version} ~${p.estimatedTokens} tok`).join(', ');
  console.log(`${check ? 'güncel' : 'yazıldı'}: ${prompts.length} prompt (${summary})`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
