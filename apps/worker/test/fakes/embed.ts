/** Sahte embedding (§12 #32): sha256 → 768 boyutlu birim vektör; aynı metin → aynı vektör. */
import { sha256Hex } from '@ogrenmen/pii';
import type { Embedder } from '../../src/data/embeddings.ts';

export function fakeVector(text: string, dims = 768): number[] {
  const out: number[] = [];
  let block = sha256Hex(text);
  while (out.length < dims) {
    for (let i = 0; i < block.length && out.length < dims; i += 2) out.push(parseInt(block.slice(i, i + 2), 16) / 127.5 - 1);
    block = sha256Hex(block);
  }
  const norm = Math.sqrt(out.reduce((a, x) => a + x * x, 0));
  return out.map((x) => x / norm);
}

export function fakeEmbedder(calls: string[] = []): Embedder {
  return async (text: string) => {
    calls.push(text);
    return fakeVector(text);
  };
}
