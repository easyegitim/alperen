/**
 * `models.json` — sağlayıcı/model/fiyat/limit/zincir tablosu (tek kaynak; BLUEPRINT §4.9).
 * Kod model adı içermez, zincir adı kullanır; TS ve Python aynı dosyayı okur.
 */
import modelsJson from '../models.json' with { type: 'json' };
import type { ModelsConfig } from './generated/models.js';
import { validate } from './validate.js';

export type { ModelsConfig } from './generated/models.js';

let cached: ModelsConfig | null = null;

/** `models.json`'u şemaya karşı doğrulayıp döner (her çağrıda derin kopya). */
export function loadModels(): ModelsConfig {
  if (!cached) cached = validate<ModelsConfig>('models', modelsJson);
  return structuredClone(cached);
}
