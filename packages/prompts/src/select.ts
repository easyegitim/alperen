/**
 * Sürüm seçimi. Öncelik:
 *   1. açık istek (`version`): yoksa OGR-PRM-003 (programcı hatası)
 *   2. `runtime_flags['prompt_versions']` sabitlemesi ({rota: sürüm}; geri alma ve deneme için admin yazar)
 *   3. `prompt_versions.active` satırı (eval kapısını geçen sürüm)
 *   4. kilitteki rota varsayılanı (`prompts.lock.json` defaults; yalnız eval kapısı ya da `bundle --promote` değiştirir)
 *   5. kilitte varsayılan yoksa pakette bulunan en yüksek sürüm
 * Veritabanının istediği sürüm bu derlemede yoksa (eski dağıtım, yeni satır) çağrı düşmez: bir sonraki kaynağa geçilir ve
 * `ignored` alanına yazılır; çağıran günlüğe yazar. Böylece veritabanı ile kod arasındaki kısa sapma sohbeti kesmez.
 */
import { PromptError } from './errors.js';
import { compareVersions } from './meta.js';

export type VersionSource = 'explicit' | 'pinned' | 'active' | 'default';

export interface VersionSources {
  /** `runtime_flags.value` (key = 'prompt_versions'): {rota: sürüm}. */
  pinned?: Readonly<Record<string, string>>;
  /** `prompt_versions` etkin satırları: {rota: sürüm}. */
  active?: Readonly<Record<string, string>>;
}

export interface VersionSelection {
  version: string;
  source: VersionSource;
  /** Bu derlemede bulunmadığı için atlanan istekler. */
  ignored: { source: 'pinned' | 'active'; version: string }[];
}

export function highestVersion(available: readonly string[]): string {
  const sorted = [...available].sort(compareVersions);
  const top = sorted[sorted.length - 1];
  if (top === undefined) throw new PromptError('OGR-PRM-003', 'sürüm listesi boş');
  return top;
}

export function selectVersion(
  route: string,
  available: readonly string[],
  opts: { version?: string; sources?: VersionSources; defaults?: Readonly<Record<string, string>> } = {},
): VersionSelection {
  if (available.length === 0) throw new PromptError('OGR-PRM-003', `${route}: hiç sürüm yok`);
  if (opts.version !== undefined) {
    if (!available.includes(opts.version)) {
      throw new PromptError('OGR-PRM-003', `${route}: istenen sürüm ${opts.version} yok (var olanlar: ${available.join(', ')})`);
    }
    return { version: opts.version, source: 'explicit', ignored: [] };
  }
  const ignored: VersionSelection['ignored'] = [];
  for (const source of ['pinned', 'active'] as const) {
    const want = opts.sources?.[source]?.[route];
    if (want === undefined) continue;
    if (available.includes(want)) return { version: want, source, ignored };
    ignored.push({ source, version: want });
  }
  const locked = opts.defaults?.[route];
  if (locked !== undefined && available.includes(locked)) return { version: locked, source: 'default', ignored };
  return { version: highestVersion(available), source: 'default', ignored };
}
