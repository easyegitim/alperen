/**
 * v1'den kalan, zod karşılığı OLMAYAN JSON Schema dosyaları (`schemas/<ad>.schema.json`).
 * Elle bakımlıdır, dışa aktarım betiği dokunmaz; yalnız henüz budanmamış Python boru hatları
 * (`pipelines/*`, `fixtures/scripts`) ve Python paketi okur. Tüketicileri budanınca bu liste ve dosyalar silinir.
 * (`x-forbidden-words` anahtar kelimesi yalnız bu dosyalarda ve yalnız Python doğrulayıcıda yaşar.)
 */
export const LEGACY_SCHEMA_NAMES = [
  'bot-response-log',
  'common',
  'diagnostic-keys',
  'diagnostic-test',
  'generation-request',
  'instructor-alert',
  'misconception-tags',
  'models',
  'nightly-facts-output',
  'query-expand',
  'question-generation',
  'research-output',
  'telegram-update',
  'template-params',
  'tutor-reply',
] as const;
