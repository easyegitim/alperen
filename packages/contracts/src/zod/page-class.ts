/** page-class — Haiku 5.5 deneme sayfası sınıflama (PLAN-v2 §8): kitapçık | optik | karalama | anahtar. */
import { z } from 'zod';
import { defineContract } from './kit.js';

export const PAGE_CLASSES = ['booklet', 'answer_sheet', 'scratch', 'answer_key', 'other'] as const;
export const ROTATIONS = [0, 90, 180, 270] as const;

export const pageClass = defineContract({
  name: 'page-class',
  title: 'PageClass',
  description: 'Yüklenen deneme sayfasının türü, dönüklüğü ve görünen soru numaraları.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      page_class: z.enum(PAGE_CLASSES).describe('booklet: soru kitapçığı, answer_sheet: optik form, scratch: karalama, answer_key: cevap anahtarı'),
      confidence: c.prob(),
      rotation_degrees: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).describe('Sayfayı dik hale getirmek için saat yönünde gereken döndürme: 0, 90, 180 ya da 270'),
      question_numbers_seen: c.arr(c.int({ min: 1, max: 500 }), { max: 60 }),
      has_figures: z.boolean(),
      section_hint: c.str({ max: 80 }).nullable().describe('Sayfanın bölümü (ör. Türkçe, Matematik); bilinmiyorsa null'),
    }),
});

export type PageClass = z.output<typeof pageClass.strict>;
