/**
 * Prompt kayıt defteri: kaynak haritasından (dosya yolu → metin) rota/sürüm listesi, katman birleştirme ve seçim.
 *
 * Birleştirme (PLAN-v2 §6; geçitte system[0] olur, 1 saat önbellekli):
 *   ürün katmanı (layers/product.vN) + rol katmanı (layers/roles/<rol>.vN) [+ extends gövdesi] + rota gövdesi
 * Parçalar kırpılır ve aralarına tek boş satır konur; sonuç yalnız kaynak metinlere bağlıdır (tarih, kullanıcı, rastgelelik
 * yok), böylece aynı rota/sürüm her süreçte bayt bayt aynı önbellek önekini üretir. Değişken bilgi (tarih, mod, sınav)
 * tur sistem mesajıyla gelir (packages/llm prompt.ts), bu metne girmez.
 */
import { createHash } from 'node:crypto';
import { PromptError } from './errors.js';
import { parseFrontMatter } from './frontmatter.js';
import { compareVersions, parseMeta, ROUTE_NAME, VERSION, type PromptMeta } from './meta.js';
import { selectVersion, type VersionSelection, type VersionSources } from './select.js';

/** Opus/Sonnet/Haiku 5.5 en kısa önbelleklenebilir önek (packages/llm prompt.ts MIN_CACHEABLE_TOKENS ile aynı). */
export const MIN_CACHEABLE_TOKENS = 512;

/**
 * Kaba token tahmini: karakter / 4. Türkçe metinde gerçek token sayısı bundan yüksektir (sondan eklemeli dil, ğ/ş/ı),
 * bu yüzden tahmin alt sınır gibi davranır: tahmin 512'yi geçiyorsa gerçek önek de geçer. Kesin sayı canlı testte
 * count_tokens ile ölçülür (test/count-tokens.live.test.ts).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export interface PromptPart {
  kind: 'layer' | 'extends' | 'route';
  /** Kaynak anahtarı (`layers/product.v1.md`, `coach_chat/v1.md`). */
  key: string;
}

export interface LoadedPrompt {
  meta: PromptMeta;
  /** Birleşik sistem metni: geçide `system.product` olarak verilir. */
  text: string;
  /** `text`'in sha256'sı (önbellek ve sürüm sapması denetimi). */
  hash: string;
  estimatedTokens: number;
  parts: PromptPart[];
  selection: VersionSelection;
}

export interface LoadOptions {
  /** Açık sürüm (eval, testler); verilirse veritabanı kaynakları yok sayılır. */
  version?: string;
  /** Veritabanından okunan sabitleme/etkin sürümler (db.ts `readVersionSources`). */
  sources?: VersionSources;
}

interface RouteEntry {
  key: string;
  meta: PromptMeta;
  body: string;
}

const ROUTE_KEY = /^([a-z][a-z0-9_]*)\/(v[1-9][0-9]*)\.md$/;
const LAYER_FILE = /^layers\/(.+)\.md$/;

export class PromptRegistry {
  private readonly entries = new Map<string, Map<string, RouteEntry>>();
  private readonly layers = new Map<string, string>();
  private readonly composed = new Map<string, Omit<LoadedPrompt, 'selection'>>();

  constructor(
    private readonly sources: Readonly<Record<string, string>>,
    private readonly defaults: Readonly<Record<string, string>> = {},
  ) {
    for (const [key, raw] of Object.entries(sources)) {
      const layer = LAYER_FILE.exec(key);
      if (layer) {
        this.layers.set(layer[1] as string, raw.replace(/\r\n?/g, '\n').trim());
        continue;
      }
      const m = ROUTE_KEY.exec(key);
      if (!m) throw new PromptError('OGR-PRM-003', `tanınmayan kaynak yolu: ${key} (beklenen <rota>/<vN>.md ya da layers/…)`);
      const [, route, version] = m as unknown as [string, string, string];
      const { data, body } = parseFrontMatter(raw, key);
      const meta = parseMeta(data, { route, version }, key);
      if (body === '') throw new PromptError('OGR-PRM-002', `${key}: gövde boş`);
      let byVersion = this.entries.get(route);
      if (!byVersion) {
        byVersion = new Map();
        this.entries.set(route, byVersion);
      }
      byVersion.set(version, { key, meta, body });
    }
  }

  /** Rota adları (alfabetik). */
  routes(): string[] {
    return [...this.entries.keys()].sort();
  }

  /** Rotanın sürümleri (küçükten büyüğe). */
  versions(route: string): string[] {
    const byVersion = this.entries.get(route);
    if (!byVersion) throw new PromptError('OGR-PRM-003', `bilinmeyen prompt rotası: ${route}`);
    return [...byVersion.keys()].sort(compareVersions);
  }

  has(route: string): boolean {
    return this.entries.has(route);
  }

  /** Katman metni (`product.v1`, `roles/coach.v1`). */
  layer(key: string): string {
    const text = this.layers.get(key);
    if (text === undefined) throw new PromptError('OGR-PRM-004', `katman yok: layers/${key}.md`);
    return text;
  }

  layerKeys(): string[] {
    return [...this.layers.keys()].sort();
  }

  /** Rota promptunu seçer ve birleştirir. */
  load(route: string, opts: LoadOptions = {}): LoadedPrompt {
    if (!ROUTE_NAME.test(route)) throw new PromptError('OGR-PRM-003', `geçersiz rota adı: ${route}`);
    if (opts.version !== undefined && !VERSION.test(opts.version)) throw new PromptError('OGR-PRM-003', `geçersiz sürüm: ${opts.version}`);
    const selection = selectVersion(route, this.versions(route), { ...opts, defaults: this.defaults });
    return { ...this.compose(route, selection.version), selection };
  }

  /** Her rota × sürüm (açık sürümle); derleme betiği, kilit ve `prompt_versions` eşitlemesi için. */
  all(): LoadedPrompt[] {
    return this.routes().flatMap((r) => this.versions(r).map((v) => this.load(r, { version: v })));
  }

  private entry(route: string, version: string): RouteEntry {
    const e = this.entries.get(route)?.get(version);
    if (!e) throw new PromptError('OGR-PRM-003', `${route}/${version} yok`);
    return e;
  }

  private compose(route: string, version: string): Omit<LoadedPrompt, 'selection'> {
    const cacheKey = `${route}@${version}`;
    const hit = this.composed.get(cacheKey);
    if (hit) return hit;
    const e = this.entry(route, version);
    const parts: PromptPart[] = e.meta.layers.map((l) => ({ kind: 'layer', key: `layers/${l}.md` }));
    const texts = e.meta.layers.map((l) => this.layer(l));
    if (e.meta.extends) {
      const [baseRoute, baseVersion] = e.meta.extends.split('/') as [string, string];
      const base = this.entries.get(baseRoute)?.get(baseVersion);
      if (!base) throw new PromptError('OGR-PRM-004', `${e.key}: extends hedefi yok: ${e.meta.extends}`);
      if (base.meta.extends) throw new PromptError('OGR-PRM-004', `${e.key}: extends tek düzeylidir (${e.meta.extends} de extends kullanıyor)`);
      if (base.meta.role !== e.meta.role) throw new PromptError('OGR-PRM-004', `${e.key}: extends hedefi aynı rolde olmalı`);
      parts.push({ kind: 'extends', key: base.key });
      texts.push(base.body);
    }
    parts.push({ kind: 'route', key: e.key });
    texts.push(e.body);
    const text = texts.map((t) => t.trim()).filter((t) => t !== '').join('\n\n');
    const out = { meta: e.meta, text, hash: sha256(text), estimatedTokens: estimateTokens(text), parts };
    this.composed.set(cacheKey, out);
    return out;
  }

  /** Kaynak haritası (derleme betiği ve testler). */
  sourceMap(): Readonly<Record<string, string>> {
    return this.sources;
  }
}
