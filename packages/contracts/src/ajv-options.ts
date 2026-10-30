/**
 * Ajv seçenekleri — çalışma zamanı doğrulayıcısı (`validate.ts`) ve standalone üretimi
 * (`scripts/gen.ts`) aynı seçeneklerle derler; böylece iki yol aynı kararı verir.
 *
 * `strict: true` (bilinmeyen anahtar kelime, yanlış şema yapısı hata verir); iki ayrıntı
 * bilinçli olarak gevşetilir: `strictTypes` (koşullu `if` dallarında `type` tekrarlanmaz) ve
 * `strictRequired` (`oneOf: [{required: [...]}]` kalıbı). `allowUnionTypes` `["string","null"]`
 * gibi birleşik türler için gerekir.
 */
import type { Options } from 'ajv';

export const AJV_OPTIONS = {
  strict: true,
  strictTypes: false,
  strictRequired: false,
  allowUnionTypes: true,
  allErrors: true,
} as const satisfies Options;

/** Ajv'nin tanımadığı ama şemalarımızda bulunan açıklama anahtar kelimeleri. */
export const ANNOTATION_KEYWORDS = ['x-version'] as const;
