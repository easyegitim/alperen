/**
 * Müfredat işlerinin sistem metni (system[0]): `@ogrenmen/prompts` paketinden, veritabanındaki sürüm sabitlemesiyle
 * (runtime_flags.prompt_versions, prompt_versions.active). Pakette rotanın promptu yoksa verilen yedek metin kullanılır
 * (sürüm `worker-<ad>`; defterde ayırt edilir). Sürüm kaynakları okunamazsa paketteki en yüksek sürüm seçilir.
 */
import { listPromptRoutes, loadPrompt } from '@ogrenmen/prompts';
import { readVersionSources } from '@ogrenmen/prompts/db';
import type { Db } from '../db.js';

export interface RoutePrompt {
  text: string;
  /** `llm_calls.prompt_version`. */
  version: string;
  packaged: boolean;
}

export async function routePrompt(db: Db, route: string, fallback?: { name: string; text: string }): Promise<RoutePrompt> {
  if (!listPromptRoutes().includes(route)) {
    if (!fallback) throw new Error(`prompts paketinde ${route} promptu yok`);
    return { text: fallback.text, version: `worker-${fallback.name}`, packaged: false };
  }
  let sources = {};
  try {
    sources = await readVersionSources(db);
  } catch {
    // tablo/bağlantı yoksa paketteki en yüksek sürüm
  }
  const p = loadPrompt(route, { sources });
  return { text: p.text, version: p.meta.version, packaged: true };
}
