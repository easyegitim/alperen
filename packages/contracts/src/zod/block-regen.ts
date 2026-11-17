/**
 * Yeniden üretim (doğrulama merdiveni, PLAN-v2 §7): model yalnız doğrulamadan geçemeyen blokları ve onların anahtarlarını
 * döner; öteki bloklar worker'da korunur (birleştirme blok kimliğiyle yapılır: apps/worker documents/draft.ts). Tam belge
 * yeniden yazılmaz: çıktı küçük kalır (maxTokens ~8000) ve yeniden üretim turu bütün notu ikinci kez üretmez.
 *
 *   document-block-regen  not: {blocks[], keys[]} (blokların biçimi document-ast ile aynıdır, kimlikler korunur)
 *   exam-block-regen      deneme/soru seti: {items[], keys[]} (exam-generation ile aynı soru ve anahtar biçimi)
 *
 * Bu sözleşmeler yalnız çıktı şeklidir (kısıtlar ve kimlik kuralları worker birleştirmesinde ve merdivende denetlenir);
 * çapraz kurallar (soru numarası eşleşmesi, anahtar-soru ilişkisi) tam belgede olduğu için burada uygulanmaz.
 */
import { z } from 'zod';
import { defineContract } from './kit.js';
import { DOCUMENT_KINDS, makeDocumentAst } from './document-ast.js';
import { generatedItem, generatedKey } from './exam-generation.js';

export const documentBlockRegen = defineContract({
  name: 'document-block-regen',
  title: 'DocumentBlockRegen',
  description: 'Not yeniden üretimi: yalnız doğrulamadan geçemeyen bloklar ve bunların anahtarları (öteki bloklar korunur).',
  llmOutput: true,
  build: (c) => {
    const doc = makeDocumentAst(c, DOCUMENT_KINDS);
    return z.strictObject({ blocks: doc.shape.blocks, keys: doc.shape.keys });
  },
});

export type DocumentBlockRegen = z.output<typeof documentBlockRegen.strict>;

export const examBlockRegen = defineContract({
  name: 'exam-block-regen',
  title: 'ExamBlockRegen',
  description: 'Deneme/soru seti yeniden üretimi: yalnız doğrulamadan geçemeyen sorular ve bunların anahtarları (öteki sorular korunur).',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      items: c.arr(generatedItem(c, { styleRequired: false }), { min: 1, max: 200 }),
      keys: c.arr(generatedKey(c), { min: 1, max: 200 }),
    }),
});

export type ExamBlockRegen = z.output<typeof examBlockRegen.strict>;
