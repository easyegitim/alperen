import 'server-only';
import { parseExamKeys, parseExamList, type ExamKeys, type ExamListRow } from '@/lib/exam-admin';
import { studentDb } from '@/server/practice/client';
import { callRpc, isMissingFunction, type RpcClient } from '@/server/practice/rpc';

// Eğitmen Sınavlar okumaları: kullanıcının JWT'siyle instructor_exam_list / instructor_exam_keys (0048; yetki ve kapsam
// veritabanında). RPC yoksa (göç uygulanmamış, E2E sahte Supabase) liste boş sayılır.

export type ExamListResult = { ok: true; rows: ExamListRow[] } | { ok: false; code: string | null };

export async function loadExamList(db?: RpcClient): Promise<ExamListResult> {
  const r = await callRpc(db ?? (await studentDb()), 'instructor_exam_list', {}, parseExamList);
  if (r.ok) return { ok: true, rows: r.data };
  if (isMissingFunction(r.error)) return { ok: true, rows: [] };
  console.error('[sinavlar] instructor_exam_list', r.code, r.error.message);
  return { ok: false, code: r.code };
}

export type ExamKeysResult = { ok: true; data: ExamKeys } | { ok: false; code: string | null };

export async function loadExamKeys(examId: string, db?: RpcClient): Promise<ExamKeysResult> {
  const r = await callRpc(db ?? (await studentDb()), 'instructor_exam_keys', { p_exam_id: examId }, parseExamKeys);
  if (r.ok) return { ok: true, data: r.data };
  if (r.code !== 'OGR-EXAM-001' && r.code !== 'OGR-AUTH-002') console.error('[sinavlar] instructor_exam_keys', r.code, r.error.message);
  return { ok: false, code: r.code };
}
