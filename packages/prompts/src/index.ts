/**
 * `@ogrenmen/prompts` — sürümlü prompt paketi (docs/PLAN-v2.md §6).
 *
 *   import { loadPrompt } from '@ogrenmen/prompts';
 *   const p = loadPrompt('solution_diagnosis');             // en yüksek sürüm
 *   const p2 = loadPrompt('coach_chat', { sources });       // db.ts readVersionSources(pool) ile sabitleme/etkin sürüm
 *   await gateway.call('solution_diagnosis', { system: { product: p.text, course, dossier }, promptVersion: p.meta.version, … });
 *
 * Kaynaklar derleme anında `src/bundle.gen.ts`'e gömülür (scripts/build-bundle.ts): çalışma anında dosya sistemi
 * okunmaz, Next.js ve worker paketlemesinde .md dosyası kaybolmaz.
 */
import { PROMPT_DEFAULTS, PROMPT_SOURCES } from './bundle.gen.js';
import { PromptRegistry, type LoadedPrompt, type LoadOptions } from './registry.js';

export * from './errors.js';
export * from './frontmatter.js';
export * from './meta.js';
export * from './select.js';
export * from './lint.js';
export * from './registry.js';
export * from './exam-input.js';

let defaultRegistry: PromptRegistry | null = null;

/** Pakete gömülü promptların kayıt defteri (tembel kurulur). */
export function promptRegistry(): PromptRegistry {
  defaultRegistry ??= new PromptRegistry(PROMPT_SOURCES, PROMPT_DEFAULTS);
  return defaultRegistry;
}

/** Rotanın promptunu seçer ve katmanlarla birleştirir: `{meta, text, hash, …}`. */
export function loadPrompt(route: string, opts: LoadOptions = {}): LoadedPrompt {
  return promptRegistry().load(route, opts);
}

/** Promptu olan rotalar (alfabetik). */
export function listPromptRoutes(): string[] {
  return promptRegistry().routes();
}

/** Rotanın sürümleri (küçükten büyüğe). */
export function listPromptVersions(route: string): string[] {
  return promptRegistry().versions(route);
}

/** Her rota × sürüm. */
export function allPrompts(): LoadedPrompt[] {
  return promptRegistry().all();
}
