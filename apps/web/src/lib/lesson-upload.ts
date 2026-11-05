'use client';

import Uppy from '@uppy/core';
import Tus from '@uppy/tus';
import { getPublicEnv } from './env';
import { createSupabaseBrowserClient } from './supabase/browser';
import { LESSON_BUCKET, TUS_CHUNK_BYTES } from '@/server/lessons/shared';

/**
 * Büyük ders dosyası (≤ 5 GB) için Supabase Storage resumable (TUS) yüklemesi: Uppy çekirdeği + TUS eklentisi, kendi
 * arayüzümüz (sade; Dashboard yok). Parça 6 MB; bağlantı koparsa eklenti aynı adresten kaldığı yerden sürer (parmak izi
 * localStorage'da). Eğitmenin oturum jetonu her istekte tazelenir (uzun yüklemede 1 saatlik jeton dolabilir).
 * Nesne adı '<auth.uid()>/<yükleme>.<uzantı>' olmalıdır (kova politikası ilk klasörü yükleyenle eşler).
 */
export interface TusJob {
  file: File;
  objectName: string;
  contentType: string;
  onProgress?: (sent: number, total: number) => void;
  signal?: AbortSignal;
}

export class UploadAborted extends Error {
  constructor() {
    super('yükleme durduruldu');
  }
}

export async function tusUpload(job: TusJob): Promise<void> {
  const env = getPublicEnv();
  const supabase = createSupabaseBrowserClient();
  const uppy = new Uppy({ autoProceed: false, allowMultipleUploadBatches: false });
  uppy.use(Tus, {
    endpoint: `${env.supabaseUrl.replace(/\/$/, '')}/storage/v1/upload/resumable`,
    chunkSize: TUS_CHUNK_BYTES,
    retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
    removeFingerprintOnSuccess: true,
    headers: { apikey: env.supabaseAnonKey, 'x-upsert': 'false' },
    allowedMetaFields: ['bucketName', 'objectName', 'contentType', 'cacheControl'],
    async onBeforeRequest(req) {
      const { data } = await supabase.auth.getSession();
      if (data.session?.access_token) req.setHeader('Authorization', `Bearer ${data.session.access_token}`);
    },
  });
  uppy.addFile({ name: job.file.name, type: job.contentType, data: job.file, meta: { bucketName: LESSON_BUCKET, objectName: job.objectName, contentType: job.contentType, cacheControl: '3600' } });
  uppy.on('upload-progress', (_file, p) => job.onProgress?.(p.bytesUploaded, p.bytesTotal ?? job.file.size));
  const onAbort = () => uppy.cancelAll();
  job.signal?.addEventListener('abort', onAbort);
  try {
    const result = await uppy.upload();
    if (job.signal?.aborted) throw new UploadAborted();
    if (!result || result.failed?.length || !result.successful?.length) throw new Error('yükleme tamamlanamadı');
    job.onProgress?.(job.file.size, job.file.size);
  } finally {
    job.signal?.removeEventListener('abort', onAbort);
    uppy.destroy();
  }
}
