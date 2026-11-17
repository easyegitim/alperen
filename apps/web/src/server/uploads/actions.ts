'use server';

import { getCurrentProfile } from '@/server/auth';
import { uploadClient } from './client';
import { submitUploadsWith, type SubmitResult } from './submit';

/** Yükle ekranının tek sunucu eylemi: yalnız öğrenci (admin değil: yükleme bir öğrenci kaydına bağlanır). */
export async function submitUploads(input: unknown): Promise<SubmitResult> {
  const current = await getCurrentProfile();
  if (!current?.profile || current.profile.role !== 'student') return { ok: false, error: 'Yükleme yalnız öğrenci hesabıyla yapılır.' };
  return submitUploadsWith(await uploadClient(), current.user, input);
}
