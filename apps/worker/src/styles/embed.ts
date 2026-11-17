/**
 * Voyage gömmesi (1024 boyut, `voyage-3.5`, input_type document). VOYAGE_API_KEY yoksa null döner: kümeleme tf-idf
 * yedeğiyle (cluster.ts) yapılır, gömme sütunları boş kalır. Ağ ya da yanıt hatası da null (iş düşmez; günlükte uyarı).
 */
export const EMBEDDING_DIM = 1024;
const BATCH = 64;

export interface EmbedOutcome {
  vectors: (number[] | null)[];
  model: string;
}

export async function embedTexts(
  texts: readonly string[],
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<EmbedOutcome | null> {
  const key = env.VOYAGE_API_KEY;
  if (!key || texts.length === 0) return null;
  const model = env.VOYAGE_MODEL ?? 'voyage-3.5';
  const vectors: (number[] | null)[] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH).map((t) => t.slice(0, 8000) || '-');
    const res = await fetchImpl('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: chunk, model, output_dimension: EMBEDDING_DIM, input_type: 'document' }),
      ...(signal ? { signal } : {}),
    });
    if (!res.ok) throw new Error(`Voyage ${res.status}`);
    const body = (await res.json()) as { data?: { index?: number; embedding?: number[] }[] };
    const got = new Array<number[] | null>(chunk.length).fill(null);
    for (const [k, d] of (body.data ?? []).entries()) {
      const idx = typeof d.index === 'number' ? d.index : k;
      if (Array.isArray(d.embedding) && d.embedding.length === EMBEDDING_DIM && idx < chunk.length) got[idx] = d.embedding;
    }
    vectors.push(...got);
  }
  return { vectors, model };
}
