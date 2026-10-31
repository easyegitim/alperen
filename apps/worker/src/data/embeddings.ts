/**
 * Gemini embedding (768 boyut, Matryoshka). Hata ya da anahtar yoksa `null` döner; hafıza o zaman
 * yalnız tam metin aramasıyla çalışır (§5.7). `halfvec` metin biçimi `[a,b,…]`.
 */
import type { FetchFn } from '../telegram/client.ts';
import { apiModelName, chain, providerInfo } from '../llm/cost.ts';

export type Embedder = (text: string) => Promise<number[] | null>;

export const EMBED_DIMS = 768;
export const EMBED_MIN_CHARS = 12;

export function geminiEmbedder(o: { base: string; apiKey: string; model: string; fetch: FetchFn; timeoutMs?: number }): Embedder {
  return async (text: string) => {
    if (o.apiKey === '' || text.trim().length < EMBED_MIN_CHARS) return null;
    try {
      const res = await o.fetch(`${o.base}/models/${o.model}:embedContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': o.apiKey },
        body: JSON.stringify({ content: { parts: [{ text }] }, outputDimensionality: EMBED_DIMS }),
        signal: AbortSignal.timeout(o.timeoutMs ?? 4000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { embedding?: { values?: number[] } };
      const v = body.embedding?.values;
      return Array.isArray(v) && v.length === EMBED_DIMS ? v : null;
    } catch {
      return null;
    }
  };
}

/**
 * Zincirden embedder (§4.9: kod model adı içermez): `chains.embedding[0]` modeli ve sağlayıcısının
 * `base` + `key_env` değeri. Ücretli anahtar yoksa aynı modelin ücretsiz katman anahtarı denenir; o da
 * yoksa `noEmbedder`.
 */
export function embedderFromChain(env: Record<string, unknown>, fetch: FetchFn): Embedder {
  const link = chain('embedding')[0];
  if (link === undefined) return noEmbedder;
  const info = providerInfo(link.provider);
  const keyOf = (name: string | undefined): string => (name !== undefined && typeof env[name] === 'string' ? (env[name] as string).trim() : '');
  const key = keyOf(info?.key_env) || keyOf(providerInfo('gemini-free')?.key_env);
  if (key === '' || info?.base === undefined) return noEmbedder;
  return geminiEmbedder({ base: info.base, apiKey: key, model: apiModelName(link.model), fetch });
}

/** Embedding kapalı (anahtar yok): her zaman FTS. */
export const noEmbedder: Embedder = async () => null;

export function toHalfvec(v: readonly number[]): string {
  return `[${v.map((x) => Number(x.toFixed(6))).join(',')}]`;
}
