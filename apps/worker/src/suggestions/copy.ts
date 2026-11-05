/**
 * Kart metni: `suggestions_copy` rotası (Haiku 5.5 · low, notification-copy şeması). Sahte kipte (OGRENMEN_LLM=fake)
 * ya da `OGRENMEN_SUGGESTIONS_COPY=template` ile şablon metin kullanılır; gerçek anahtarla kod değişmeden Haiku yazar.
 * Güvenlik ağı: LLM çıktısı sınırları aşarsa, şablondaki bir sayıyı (soru, dakika, gün) değiştirirse ya da girdide
 * olmayan bir sayı uydurursa, emoji/ünlem/yüzde içerirse ya da çağrı düşerse (ret, ayrıştırma, ağ) şablon kullanılır.
 * Başlığı yalnız kahraman kartta (rank 0, başlatılabilir) LLM yazar; kutular ve bildirimler şablon başlığını korur
 * (mockup S02: "Haftalık ödev", "Eksik analizi" gibi kısa etiketler), LLM yalnız alt satırı yazar. Aynı kart (copy_key) bir önceki yenilemede yazıldıysa metni
 * yeniden kullanılır: gece ve her etkinlikten sonra çalışan iş aynı kart için tekrar ücret ödemez.
 */
import type { Gateway } from '@ogrenmen/llm';
import type { Logger } from '../log.js';
import { NOTICE_KINDS, type PlannedSuggestion } from './rules.js';

export type CopyMode = 'template' | 'llm';
export type CopySource = 'template' | 'llm' | 'reused' | 'fallback';

export interface CardCopy {
  title: string;
  subtitle: string;
  source: CopySource;
}

export function copyModeFromEnv(env: NodeJS.ProcessEnv = process.env): CopyMode {
  const forced = env.OGRENMEN_SUGGESTIONS_COPY;
  if (forced === 'template' || forced === 'llm') return forced;
  return env.OGRENMEN_LLM === 'fake' ? 'template' : 'llm';
}

const numbersOf = (s: string) => (s.match(/\d+/g) ?? []).sort();
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;

/** Kahraman kart mı (başlığını LLM yazabilir): rank 0 ve başlatılabilir tür. */
export function isHeroCard(card: PlannedSuggestion): boolean {
  return card.rank === 0 && !NOTICE_KINDS.includes(card.kind);
}

/**
 * LLM metni kabul edilebilir mi: uzunluk sınırları; ünlem, yüzde ve emoji yok; şablon alt satırındaki her sayı
 * korunmuş; çıktıdaki her sayı şablonda ya da kart girdisinde (copyInput) var (uydurma sayı yok, ör. "4 sayfalık").
 */
export function acceptableCopy(card: PlannedSuggestion, title: string, body: string): boolean {
  const t = title.trim();
  const b = body.trim();
  if (t.length < 1 || t.length > 120 || b.length > 160) return false;
  if (/[!%]/.test(t + b) || PICTOGRAPHIC.test(t + b)) return false;
  const got = numbersOf(`${t} ${b}`);
  const want = numbersOf(card.subtitle);
  const have = new Set(got);
  if (!want.every((n) => have.has(n))) return false;
  const allowed = new Set([...numbersOf(card.title), ...want, ...numbersOf(JSON.stringify(card.copyInput))]);
  return got.every((n) => allowed.has(n));
}

export interface WriteCopyOptions {
  mode: CopyMode;
  gateway?: () => Promise<Gateway>;
  /** system[0] (packages/prompts `suggestions_copy`). */
  system?: { text: string; version: string } | null;
  studentRef?: string | null;
  /** Önceki aktif kartların metni (copy_key → metin). */
  previous?: ReadonlyMap<string, { title: string; subtitle: string | null }>;
  log?: Logger;
  signal?: AbortSignal;
}

export async function writeCopy(cards: readonly PlannedSuggestion[], opts: WriteCopyOptions): Promise<CardCopy[]> {
  const out: CardCopy[] = [];
  let gateway: Gateway | null = null;
  for (const card of cards) {
    const hero = isHeroCard(card);
    const prev = opts.previous?.get(card.key);
    if (prev && prev.title && (hero || prev.title === card.title) && acceptableCopy(card, prev.title, prev.subtitle ?? '')) {
      out.push({ title: prev.title, subtitle: prev.subtitle ?? card.subtitle, source: 'reused' });
      continue;
    }
    if (opts.mode === 'template' || !opts.gateway || !opts.system) {
      out.push({ title: card.title, subtitle: card.subtitle, source: 'template' });
      continue;
    }
    try {
      gateway ??= await opts.gateway();
      const res = await gateway.call('suggestions_copy', {
        system: { product: opts.system.text },
        user: JSON.stringify({ ...card.copyInput, template: { title: card.title, body: card.subtitle } }),
        promptVersion: opts.system.version,
        studentRef: opts.studentRef ?? null,
        purpose: 'suggestions.refresh',
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const data = res.data as { title?: unknown; body?: unknown } | null;
      // Kutu ve bildirim başlığı şablonda kalır (kısa etiket); LLM'in başlığı yalnız kahraman kartta kullanılır
      const title = hero ? (typeof data?.title === 'string' ? data.title.trim() : '') : card.title;
      const body = typeof data?.body === 'string' ? data.body.trim() : '';
      if (acceptableCopy(card, title, body)) out.push({ title, subtitle: body, source: 'llm' });
      else {
        opts.log?.warn('öneri metni şablona döndü (LLM çıktısı kurala uymadı)', { kind: card.kind });
        out.push({ title: card.title, subtitle: card.subtitle, source: 'fallback' });
      }
    } catch (err) {
      opts.log?.warn('öneri metni şablona döndü (LLM çağrısı düştü)', { kind: card.kind, error: (err as Error).message });
      out.push({ title: card.title, subtitle: card.subtitle, source: 'fallback' });
    }
  }
  return out;
}
