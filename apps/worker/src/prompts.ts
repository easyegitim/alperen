/**
 * Rota sistem metni (system[0]): `@ogrenmen/prompts` paketinden, veritabanındaki sürüm sabitlemesiyle
 * (`runtime_flags.prompt_versions`, `prompt_versions.active`; 60 sn önbellek). Pakette promptu henüz olmayan rota için
 * çağıranın verdiği yedek metin kullanılır (sürüm `worker-<ad>`), böylece iş düşmez ve defterde ayırt edilir.
 */
import { PromptError } from '@ogrenmen/prompts';
import { createPromptResolver } from '@ogrenmen/prompts/db';
import type { Db } from './db.js';

export interface SystemPrompt {
  text: string;
  /** `llm_calls.prompt_version`. */
  version: string;
  /** Paketten mi geldi (false: yedek metin). */
  packaged: boolean;
}

type Resolver = ReturnType<typeof createPromptResolver>;
const resolvers = new WeakMap<Db, Resolver>();

function resolverFor(db: Db): Resolver {
  let r = resolvers.get(db);
  if (!r) {
    r = createPromptResolver(db, { ttlMs: 60_000 });
    resolvers.set(db, r);
  }
  return r;
}

export async function systemPrompt(db: Db, route: string, fallback?: { name: string; text: string }): Promise<SystemPrompt> {
  try {
    const p = await resolverFor(db).load(route);
    return { text: p.text, version: p.meta.version, packaged: true };
  } catch (err) {
    if (fallback && err instanceof PromptError && err.code === 'OGR-PRM-003') {
      return { text: fallback.text, version: `worker-${fallback.name}`, packaged: false };
    }
    throw err;
  }
}
