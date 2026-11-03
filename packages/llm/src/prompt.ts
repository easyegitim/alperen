/**
 * Önbellek dostu istem derleme (PLAN-v2 §3.3; claude-api shared/prompt-caching.md):
 *
 *   tools:     sabit liste (rota başına), ada göre sıralı           — system[0] kesme noktası ile birlikte önbelleğe girer
 *   system[0]: ürün + persona + çıktı kuralları                       cache 1h
 *   system[1]: ders bloğu (müfredat ağacı, yanılgı etiketleri, tarzlar) cache 1h
 *   system[2]: dossier bloğu (deterministik sıra, gün hassasiyeti)     cache 5dk
 *   messages:  geçmiş…, kullanıcı turu, {role:"system", "Bugün … Mod: …"} + üst düzey cache_control (kuyruk)
 *
 * Değişken bilgi (tarih, mod, sınav bağlamı) asla system bloklarına girmez; tur sistem mesajıyla sona eklenir.
 * En çok 4 kesme noktası; 1 saatlik girdiler 5 dakikalıklardan önce gelir. Önbelleğe alınabilir en kısa önek
 * 512 token'dır (Opus/Sonnet/Haiku 5.5); daha kısa önekler sessizce önbelleğe girmez.
 */
import type {
  BetaCacheControlEphemeral,
  BetaMessageParam,
  BetaTextBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { RouteConfigError } from './errors.js';
import { familyOf, type CachePolicy, type CacheTtl } from './routes.js';

export interface SystemParts {
  /** Ürün + persona + çıktı kuralları (herkese aynı, sabit). */
  product: string;
  /** Ders bloğu (ders başına ortak). */
  course?: string | null;
  /** Dossier bloğu (öğrenci başına; `student_dossier_cache.rendered`). */
  dossier?: string | null;
}

export const MAX_CACHE_BREAKPOINTS = 4;
/** Opus/Sonnet/Haiku 5.5 en kısa önbelleklenebilir önek (token). */
export const MIN_CACHEABLE_TOKENS = 512;

export function cacheControl(ttl: CacheTtl): BetaCacheControlEphemeral {
  // Varsayılan TTL 5 dk; 1 saat açıkça yazılır.
  return ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
}

function textBlock(text: string, ttl: CacheTtl | null): BetaTextBlockParam {
  return ttl ? { type: 'text', text, cache_control: cacheControl(ttl) } : { type: 'text', text };
}

/**
 * Üç system bloğunu sırayla kurar (verilmeyen blok atlanır). Boş metin reddedilir: boş blok önbellek
 * önekini değiştirmez ama API boş metin bloğunu kabul etmez.
 */
export function buildSystemBlocks(parts: SystemParts, cache: CachePolicy): BetaTextBlockParam[] {
  if (!parts.product || parts.product.trim() === '') throw new RouteConfigError('ürün system bloğu boş olamaz');
  const blocks: BetaTextBlockParam[] = [textBlock(parts.product, cache.productTtl)];
  if (parts.course) blocks.push(textBlock(parts.course, cache.courseTtl));
  if (parts.dossier) blocks.push(textBlock(parts.dossier, cache.dossierTtl));
  return blocks;
}

export type CoachMode = 'hint' | 'explain' | 'solve';

const MODE_TR: Record<CoachMode, string> = { hint: 'ipucu', explain: 'açıkla', solve: 'çözümü göster' };

export interface TurnContext {
  /** Gün (YYYY-MM-DD, Europe/Istanbul). Verilmezse `now`'dan türetilir. */
  date?: string;
  now?: Date;
  mode?: CoachMode;
  /** Sınav bağlamı ("TYT 2027-06-20, 230 gün kaldı" gibi). */
  exam?: string | null;
  /** Ek satırlar (deterministik sırayla eklenir). */
  extra?: readonly string[];
}

/** Europe/Istanbul gününü YYYY-MM-DD biçiminde verir. */
export function istanbulDate(now: Date): string {
  // en-CA biçimi YYYY-MM-DD üretir.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Tur bağlamı metni: "Bugün 2026-11-02. Mod: ipucu." (+ sınav, ek satırlar). */
export function renderTurnContext(ctx: TurnContext): string {
  const date = ctx.date ?? istanbulDate(ctx.now ?? new Date());
  const parts = [`Bugün ${date}.`];
  if (ctx.mode) parts.push(`Mod: ${MODE_TR[ctx.mode]}.`);
  if (ctx.exam) parts.push(`Sınav: ${ctx.exam}.`);
  for (const line of ctx.extra ?? []) parts.push(line);
  return parts.join(' ');
}

/**
 * Ortadaki sistem mesajını destekleyen modeller (prompt-caching.md "Mid-conversation system messages"):
 * Opus 5.5 ve Sonnet 5.5. Haiku 5.5 belgede yok; orada tur bağlamı kullanıcı turunun sonuna metin olarak eklenir.
 */
export function supportsSystemMessages(model: string): boolean {
  const fam = familyOf(model);
  return fam === 'opus' || fam === 'sonnet';
}

/** Tur sistem mesajı (`role:"system"`); kullanıcı turundan sonra, son öğe olarak eklenir. */
export function buildTurnSystem(ctx: TurnContext): BetaMessageParam {
  return { role: 'system', content: renderTurnContext(ctx) };
}

/** Haiku için yedek: tur bağlamını kullanıcı turunun sonuna `<system-reminder>` metin bloğu olarak ekler. */
export function turnReminderBlock(ctx: TurnContext): BetaTextBlockParam {
  return { type: 'text', text: `<system-reminder>${renderTurnContext(ctx)}</system-reminder>` };
}

/** Ada göre (kararlı) sıralanmış araç listesi: araçlar önekin başında; sıra değişirse önbellek düşer. */
export function sortTools<T extends { name: string }>(tools: readonly T[]): T[] {
  return [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** Bir istek gövdesindeki `cache_control` kesme noktalarını sırayla sayar (testler ve çalışma anı denetimi). */
export function collectBreakpoints(body: {
  tools?: readonly unknown[];
  system?: string | readonly unknown[];
  messages: readonly unknown[];
  cache_control?: unknown;
}): { where: string; ttl: '5m' | '1h' }[] {
  const out: { where: string; ttl: '5m' | '1h' }[] = [];
  const visit = (where: string, node: unknown) => {
    if (node && typeof node === 'object' && 'cache_control' in node) {
      const cc = (node as { cache_control?: { ttl?: string } | null }).cache_control;
      if (cc) out.push({ where, ttl: cc.ttl === '1h' ? '1h' : '5m' });
    }
  };
  (body.tools ?? []).forEach((t, i) => visit(`tools[${i}]`, t));
  if (Array.isArray(body.system)) body.system.forEach((b, i) => visit(`system[${i}]`, b));
  body.messages.forEach((m, i) => {
    const content = (m as { content?: unknown }).content;
    if (Array.isArray(content)) content.forEach((b, j) => visit(`messages[${i}].content[${j}]`, b));
  });
  if (body.cache_control) {
    const cc = body.cache_control as { ttl?: string };
    out.push({ where: 'top-level', ttl: cc.ttl === '1h' ? '1h' : '5m' });
  }
  return out;
}

/** Kesme noktası kurallarını denetler: ≤4 ve 1 saatlikler 5 dakikalıklardan önce. */
export function assertBreakpoints(body: Parameters<typeof collectBreakpoints>[0]): void {
  const bps = collectBreakpoints(body);
  if (bps.length > MAX_CACHE_BREAKPOINTS) {
    throw new RouteConfigError(`en çok ${MAX_CACHE_BREAKPOINTS} cache_control kesme noktası (${bps.length} var)`);
  }
  const firstShort = bps.findIndex((b) => b.ttl === '5m');
  if (firstShort !== -1 && bps.slice(firstShort).some((b) => b.ttl === '1h')) {
    throw new RouteConfigError('1 saatlik önbellek girdisi 5 dakikalıktan sonra gelemez');
  }
}
