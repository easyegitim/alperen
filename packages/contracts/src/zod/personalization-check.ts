/**
 * personalization-check — kişiselleştirme denetimi (PLAN-v2 §7 doğrulama merdiveni; Haiku 5.5 · low): üretilen nottaki
 * her "Senin sık yaptığın hata" kutusu (`common_mistake_callout`) öğrencinin gerçek bir örüntüsüne (patterns.md satırı,
 * açık yanılgı, analiz) doğru kimlik ve tarihle mi başvuruyor, metni o örüntüyü doğru mu anlatıyor.
 *
 * `ok` = hiç sorunlu kutu yok. Sorunlu kutular `offending_block_ids`'te; her biri için `findings` neden ve kısa not verir.
 * Worker yalnız bu blokları yeniden üretir (ya da kutuyu genel uyarıya çevirir).
 */
import { z } from 'zod';
import { addIssue, defineContract } from './kit.js';

/** Sorun türü: kimlik dossier'de yok · tarih tutmuyor · metin örüntüyü anlatmıyor · kutu kişisel değil (genel uyarı). */
export const PERSONALIZATION_PROBLEMS = ['unknown_pattern', 'date_mismatch', 'text_mismatch', 'generic'] as const;

export const personalizationCheck = defineContract({
  name: 'personalization-check',
  title: 'PersonalizationCheck',
  description:
    'Kişiselleştirme denetimi: nottaki her hata kutusu gerçek bir örüntüye (kimlik + tarih) başvuruyor mu; sorunlu blok kimlikleri ve nedenleri.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      ok: z.boolean().describe('Bütün hata kutuları gerçek örüntülere doğru başvuruyorsa true'),
      offending_block_ids: c.arr(c.str({ min: 1, max: 40 }), { max: 60 }).describe('Sorunlu common_mistake_callout blok kimlikleri'),
      findings: c.arr(
        z.strictObject({
          block_id: c.str({ min: 1, max: 40 }),
          problem: z.enum(PERSONALIZATION_PROBLEMS),
          note: c.str({ min: 1, max: 300, desc: 'Eğitmenin okuyacağı kısa açıklama' }),
        }),
        { max: 60 },
      ),
    }),
  refine: (v, ctx) => {
    if (v.ok !== (v.offending_block_ids.length === 0)) addIssue(ctx, ['ok'], 'ok yalnız sorunlu blok yokken true olur');
    const offending = new Set(v.offending_block_ids);
    if (offending.size !== v.offending_block_ids.length) addIssue(ctx, ['offending_block_ids'], 'yinelenen blok kimliği');
    const found = new Set(v.findings.map((f) => f.block_id));
    for (const id of offending) if (!found.has(id)) addIssue(ctx, ['findings'], `${id} için neden yazılmalı`);
    v.findings.forEach((f, i) => {
      if (!offending.has(f.block_id)) addIssue(ctx, ['findings', i, 'block_id'], `${f.block_id} offending_block_ids'te yok`);
    });
  },
});

export type PersonalizationCheck = z.output<typeof personalizationCheck.strict>;
