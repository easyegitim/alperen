'use server';

import { getCurrentUser } from '@/server/auth';
import { studentDb } from './client';
import { practiceErrorMessage } from './present';
import { isUuid } from './rpc';
import { answerItem, finishPractice } from './service';

export type AnswerActionResult =
  | { ok: true; no: number; correct: boolean; remaining: number }
  | { ok: false; message: string; /** Set artık cevaplanamaz (bitmiş): sonuç ekranına gidilir. */ closed: boolean };

export type FinishActionResult = { ok: true; href: string } | { ok: false; message: string };

/** Oynatıcıdan tek cevap: answer_practice_item (notlama, attempts, gözlem, BKT veritabanında). */
export async function answerPracticeAction(input: { setId: string; questionId: string; answer: string; responseMs?: number | null }): Promise<AnswerActionResult> {
  if (!isUuid(input?.setId) || !isUuid(input?.questionId)) return { ok: false, message: practiceErrorMessage('OGR-PRAC-001'), closed: false };
  const answer = typeof input.answer === 'string' ? input.answer.trim().slice(0, 64) : '';
  if (!answer) return { ok: false, message: practiceErrorMessage('OGR-PRAC-005'), closed: false };
  if (!(await getCurrentUser())) return { ok: false, message: practiceErrorMessage('OGR-AUTH-001'), closed: false };
  const res = await answerItem(await studentDb(), { setId: input.setId, questionId: input.questionId, answer, responseMs: input.responseMs ?? null });
  if (!res.ok) return { ok: false, message: practiceErrorMessage(res.code), closed: res.code === 'OGR-PRAC-003' };
  return { ok: true, no: res.data.no, correct: res.data.correct, remaining: res.data.remaining };
}

/** Set bitişi: finish_practice (idempotent; suggestions.refresh işini kuyruğa atar) → sonuç ekranı. */
export async function finishPracticeAction(setId: string): Promise<FinishActionResult> {
  if (!isUuid(setId)) return { ok: false, message: practiceErrorMessage('OGR-PRAC-001') };
  if (!(await getCurrentUser())) return { ok: false, message: practiceErrorMessage('OGR-AUTH-001') };
  const res = await finishPractice(await studentDb(), setId);
  if (!res.ok) return { ok: false, message: practiceErrorMessage(res.code) };
  return { ok: true, href: `/ogrenci/test/${setId}/sonuc` };
}
