/**
 * solution-diagnosis — Opus 5.5 çözüm teşhisi (Akış 1 ve deneme soru teşhisi).
 * Soruyu bağımsız çözer, öğrencinin adımlarını hizalar, ilk bozulan adımı, hata nedenini, yaprak
 * kazanım(lar)ı ve yanılgı etiketini bulur; uygun yaprak yoksa alt kazanım önerir (PLAN-v2 §2 Akış 1, §3.1).
 */
import { z } from 'zod';
import { ERROR_CAUSES, VERDICTS, skillCode, tagCode } from './common.js';
import { addIssue, defineContract } from './kit.js';

export const solutionDiagnosis = defineContract({
  name: 'solution-diagnosis',
  title: 'SolutionDiagnosis',
  description:
    'Çözüm teşhisi: soru metni, öğrencinin adımları, ilk bozulan adım, hata nedeni, kazanım ve yanılgı etiketi. ' +
    'verdict=correct ise failing_step_no ve error_cause null olur.',
  llmOutput: true,
  build: (c) =>
    z.strictObject({
      question_text: c.str({ max: 4000, desc: 'Sorunun okunmuş/yazıya dökülmüş metni' }),
      student_work_text: c.str({ max: 6000, desc: 'Öğrencinin çözümünün yazıya dökülmüş hali; çözüm yoksa boş' }),
      reference_solution_steps: c.arr(c.str({ min: 1, max: 600 }), { max: 20 }),
      student_steps: c.arr(
        z.strictObject({
          no: c.int({ min: 1, max: 40 }),
          text: c.str({ max: 600 }),
          status: z.enum(['ok', 'error', 'missing']).describe('missing: olması gereken ama öğrencinin yazmadığı adım'),
        }),
        { max: 40 },
      ),
      failing_step_no: c.int({ min: 1, max: 40 }).nullable().describe('İlk bozulan adımın numarası; yoksa null'),
      verdict: z.enum(VERDICTS),
      error_cause: z.enum(ERROR_CAUSES).nullable().describe('Doğru çözümde null'),
      why_tr: c.uiText({ min: 5, max: 400, desc: 'Tek cümle, sen dili, ünlemsiz: neden takıldı' }),
      skill_ids: c.arr(skillCode(c), { max: 3 }),
      misconception_tags: c.arr(tagCode(c), { max: 3 }),
      proposed_subskill: z
        .strictObject({
          code: skillCode(c),
          name: c.str({ min: 2, max: 120 }),
          parent_code: skillCode(c),
          description: c.str({ max: 400 }),
        })
        .nullable()
        .describe('Uygun yaprak yoksa önerilen alt kazanım; yoksa null'),
      style_hint: c.str({ max: 200 }).nullable().describe('Sorunun tarzına ipucu (format/tuzak); yoksa null'),
      key_dispute: c
        .added(
          z
            .strictObject({
              suspected: z.boolean().describe('Verilen anahtar kendi çözümünle çelişiyor ve çözümünü yeniden denetledikten sonra da çelişiyor: true'),
              model_answer: c.str({ max: 80 }).nullable().describe('Kendi çözümünün cevabı (şık harfi ya da değer); bilinmiyorsa null'),
            })
            .nullable(),
          null,
        )
        .describe('Deneme anahtarı şüpheliyse doldurulur (eğitmen incelemesine gider); anahtar çelişmiyorsa ya da deneme bağlamı yoksa null'),
      confidence: c.prob(),
    }),
  refine: (v, ctx) => {
    const nos = v.student_steps.map((s) => s.no);
    if (new Set(nos).size !== nos.length) addIssue(ctx, ['student_steps'], 'adım numaraları tekil olmalı');
    if (v.failing_step_no !== null) {
      const step = v.student_steps.find((s) => s.no === v.failing_step_no);
      if (!step) addIssue(ctx, ['failing_step_no'], 'failing_step_no student_steps içinde olmalı');
      else if (step.status === 'ok') addIssue(ctx, ['failing_step_no'], 'bozulan adımın durumu ok olamaz');
    }
    if (v.verdict === 'correct') {
      if (v.failing_step_no !== null) addIssue(ctx, ['failing_step_no'], 'doğru çözümde failing_step_no null olmalı');
      if (v.error_cause !== null) addIssue(ctx, ['error_cause'], 'doğru çözümde error_cause null olmalı');
      if (v.student_steps.some((s) => s.status === 'error')) addIssue(ctx, ['student_steps'], 'doğru çözümde hatalı adım olamaz');
    }
    if ((v.verdict === 'wrong' || v.verdict === 'incomplete') && v.error_cause === null) {
      addIssue(ctx, ['error_cause'], 'yanlış/eksik çözümde error_cause zorunlu');
    }
    if (v.verdict !== 'unreadable' && v.skill_ids.length === 0 && v.proposed_subskill === null) {
      addIssue(ctx, ['skill_ids'], 'skill_ids boşsa proposed_subskill verilmeli');
    }
  },
});

export type SolutionDiagnosis = z.output<typeof solutionDiagnosis.strict>;
