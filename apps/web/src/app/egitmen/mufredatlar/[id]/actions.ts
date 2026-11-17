'use server';

import { revalidatePath } from 'next/cache';
import { curriculumErrorMessage, isUuid } from '@/lib/curriculum-tree';
import type { Json } from '@/lib/supabase/types';
import { requireRole } from '@/server/auth';
import { curriculumClient } from '@/server/curricula';

// Müfredat editörünün sunucu eylemleri: hepsi kullanıcının JWT'siyle RPC çağırır (yetki DB'de:
// app.can_edit_curriculum / app.can_publish_curriculum / decide_proposal). Hata iletisi Türkçe ve kısa döner; sayfa
// revalidatePath ile tazelenir.

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Yeni sürüm açıldığında kimliği (sayfa oraya geçer). */
  id?: string;
}

export type TreeOp =
  | { op: 'rename'; skill_id: string; name: string }
  | { op: 'add'; parent_id: string; name: string }
  | { op: 'move'; skill_id: string; direction: 'up' | 'down' }
  | { op: 'move'; skill_id: string; parent_id: string }
  | { op: 'merge'; keep_id: string; drop_id: string };

const page = (id: string) => `/egitmen/mufredatlar/${id}`;

async function guard(id: string): Promise<ActionResult | null> {
  await requireRole('instructor', 'admin');
  return isUuid(id) ? null : { ok: false, error: 'Müfredat bulunamadı.' };
}

/** Ağaçta tek düzenleme (curriculum_edit). */
export async function editTree(curriculumId: string, change: TreeOp): Promise<ActionResult> {
  const bad = await guard(curriculumId);
  if (bad) return bad;
  const { op, ...args } = change;
  const supabase = await curriculumClient();
  const { error } = await supabase.rpc('curriculum_edit', { p_curriculum: curriculumId, p_op: op, p_args: args as unknown as Json });
  if (error) return { ok: false, error: curriculumErrorMessage(error.message) };
  revalidatePath(page(curriculumId));
  return { ok: true };
}

/** Taslağı yayınla (curriculum_publish): önceki sürümler emekli, kayıtlar ve ustalık kodla taşınır. */
export async function publishCurriculum(curriculumId: string): Promise<ActionResult> {
  const bad = await guard(curriculumId);
  if (bad) return bad;
  const supabase = await curriculumClient();
  const { error } = await supabase.rpc('curriculum_publish', { p_curriculum: curriculumId });
  if (error) return { ok: false, error: curriculumErrorMessage(error.message) };
  revalidatePath('/egitmen/mufredatlar', 'layout');
  return { ok: true };
}

/** Yayındaki sürümden yeni taslak (curriculum_new_version); açık taslak varsa onu döner. */
export async function openNewVersion(curriculumId: string): Promise<ActionResult> {
  const bad = await guard(curriculumId);
  if (bad) return bad;
  const supabase = await curriculumClient();
  const { data, error } = await supabase.rpc('curriculum_new_version', { p_curriculum: curriculumId });
  if (error || typeof data !== 'string') return { ok: false, error: curriculumErrorMessage(error?.message) };
  revalidatePath('/egitmen/mufredatlar', 'layout');
  return { ok: true, id: data };
}

/** Düşen taslağı yeniden kur (curriculum_draft_retry): durum 'queued' olur, curriculum.draft işi yeniden kuyrukta. */
export async function retryDraft(curriculumId: string): Promise<ActionResult> {
  const bad = await guard(curriculumId);
  if (bad) return bad;
  const supabase = await curriculumClient();
  const { error } = await supabase.rpc('curriculum_draft_retry', { p_curriculum: curriculumId });
  if (error) return { ok: false, error: curriculumErrorMessage(error.message) };
  revalidatePath(page(curriculumId));
  return { ok: true };
}

/** Otopilot anahtarı (curriculum_set_autopilot). */
export async function setAutopilot(curriculumId: string, on: boolean): Promise<ActionResult> {
  const bad = await guard(curriculumId);
  if (bad) return bad;
  const supabase = await curriculumClient();
  const { error } = await supabase.rpc('curriculum_set_autopilot', { p_curriculum: curriculumId, p_on: on });
  if (error) return { ok: false, error: curriculumErrorMessage(error.message) };
  revalidatePath(page(curriculumId));
  return { ok: true };
}

/** Öneriye karar (decide_proposal): kabul uygulanır (birleştirme yeni sürüm işi açar), ret kapatır. */
export async function decideProposal(curriculumId: string, proposalId: string, accept: boolean): Promise<ActionResult> {
  const bad = await guard(curriculumId);
  if (bad) return bad;
  if (!isUuid(proposalId)) return { ok: false, error: 'Öneri bulunamadı.' };
  const supabase = await curriculumClient();
  const { error } = await supabase.rpc('decide_proposal', { p_id: proposalId, p_accept: accept, p_note: accept ? 'eğitmen kabul etti' : 'eğitmen reddetti' });
  if (error) return { ok: false, error: curriculumErrorMessage(error.message) };
  revalidatePath(page(curriculumId));
  return { ok: true };
}
