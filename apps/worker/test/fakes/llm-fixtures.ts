/** fixtures/llm/** dosyalarını Vite `import.meta.glob` ile yükler (vitest; Node ve Workers havuzu). */
import type { LlmFixtures } from './providers.ts';

const modules = import.meta.glob('../../../../fixtures/llm/*/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export function loadLlmFixtures(): LlmFixtures {
  const out: LlmFixtures = {};
  for (const [path, data] of Object.entries(modules)) {
    const m = /fixtures\/llm\/([^/]+)\/([^/]+\.json)$/.exec(path);
    if (m === null) continue;
    const purpose = m[1] ?? '';
    (out[purpose] ??= []).push({ name: m[2] ?? '', data });
  }
  return out;
}
