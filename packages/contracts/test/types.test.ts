/** Üretilen tipler (src/generated/*.d.ts) fikstürlerle derlenir; `bun run typecheck` bu dosyayı da denetler. */
import { join } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { validate, type BotResponseLog, type ExamPriorityPlan, type QuestionItem, type TutorReply } from '../src/index.js';
import { validateAnswerKey, type AnswerKey } from '../src/answer-key.js';
import { FIXTURES, readJson } from './helpers.js';

describe('üretilen tipler', () => {
  it('validate<T> doğru tipi döner', () => {
    const qi = validate<QuestionItem>('question-item', readJson(join(FIXTURES, 'question-item', 'valid', 'mcq-diagnostic.json')));
    expectTypeOf(qi.kind).toEqualTypeOf<'mcq' | 'numeric'>();
    expect(qi.options?.length).toBe(4);
    const tr = validate<TutorReply>('tutor-reply', readJson(join(FIXTURES, 'tutor-reply', 'valid', 'socratic-hint.json')));
    expectTypeOf(tr.escalate_reason).toEqualTypeOf<null | 'bot_unsure' | 'grade_attendance_payment' | 'human_requested'>();
    const plan = validate<ExamPriorityPlan>('exam-priority-plan', readJson(join(FIXTURES, 'exam-priority-plan', 'valid', 'two-years.json')));
    expectTypeOf(plan.title).toEqualTypeOf<'Sıklık analizine göre öncelikler'>();
    const log: BotResponseLog = validate<BotResponseLog>('bot-response-log', readJson(join(FIXTURES, 'bot-response-log', 'valid', 'chat-ok.json')));
    expect(log.provider_attempts[0]?.status).toBe('ok');
  });

  it('answer-key alt yolu anahtarı doğrular', () => {
    const key: AnswerKey = validateAnswerKey(readJson(join(FIXTURES, 'answer-key', 'valid', 'mcq-key.json')));
    expect(key.correct_option).toBe('B');
    expect(() => validateAnswerKey({ question_id: 'x' })).toThrow(/OGR-CONTRACT-001/);
  });
});
