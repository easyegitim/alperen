/**
 * `x-forbidden-words` özel anahtar kelimesi (BLUEPRINT §4, ilke 10): şemanın kökünde verilen
 * kelimelerden biri verideki herhangi bir metin değerinde (büyük/küçük harf duyarsız, Türkçe
 * İ/ı katlanmış, düz alt dize; "k" ile biten kelimede k → ğ yumuşaması da) geçerse doğrulama düşer. Örnek: `exam-priority-plan`
 * ["tahmin", "çıkacak", "kesin", "garanti"], `instructor-alert` ["depresif", "tembel", …].
 *
 * Tanım Ajv "code" anahtar kelimesidir; böylece Ajv standalone ile önceden derlenen
 * `src/generated/validators.js` de aynı denetimi içerir (çekirdek `runtime/core.js` gömülür).
 * Python eşleniği: `ogrenmen_contracts._core.find_forbidden_word` (aynı vaka dosyası).
 */
import { _, str, stringify, type CodeKeywordDefinition, type KeywordCxt } from 'ajv/dist/2020.js';
import { ogrContainsForbidden, ogrFindForbiddenWord, ogrNormalizeTr } from './runtime/core.js';

export const FORBIDDEN_WORDS_KEYWORD = 'x-forbidden-words';

/** Türkçe duyarlı normalleştirme (İ→i, I→ı→i, küçük harf). */
export function normalizeTr(text: string): string {
  return ogrNormalizeTr(text);
}

/** `word` metinde geçiyor mu ("tahminen", "öntahmin", "çıkacağı" evet; "Kesir" hayır). */
export function containsForbiddenWord(text: string, word: string): boolean {
  return ogrContainsForbidden(text, word);
}

/** Verideki ilk yasaklı kelime (listedeki yazımıyla) ya da `null`. Anahtarlar taranmaz. */
export function findForbiddenWord(data: unknown, words: readonly string[]): string | null {
  return ogrFindForbiddenWord(data, words);
}

/** Ajv anahtar kelime tanımı (çalışma zamanı Ajv'si ve standalone üretimi aynı tanımı kullanır). */
export const forbiddenWordsKeyword: CodeKeywordDefinition = {
  keyword: FORBIDDEN_WORDS_KEYWORD,
  schemaType: 'array',
  metaSchema: { type: 'array', minItems: 1, items: { type: 'string', minLength: 1 } },
  error: {
    message: ({ params }) => str`yasaklı kelime içeriyor: ${params.word}`,
    params: ({ params }) => _`{word: ${params.word}}`,
  },
  code(cxt: KeywordCxt) {
    const { gen, data, schema } = cxt;
    const fn = gen.scopeValue('func', { ref: ogrFindForbiddenWord, code: _`ogrFindForbiddenWord` });
    const hit = gen.const('forbidden', _`${fn}(${data}, ${stringify(schema)})`);
    cxt.setParams({ word: hit });
    cxt.fail(_`${hit} !== null`);
  },
};
