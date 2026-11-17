'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, PenLine, X } from 'lucide-react';
import { Button, Notice, buttonClasses } from '@/ds';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { sendBlankReason, sendHowFar } from '@/server/exam-result/actions';
import { HOW_FAR_MAX_CHARS, HOW_FAR_MAX_PHOTOS } from '@/server/exam-result/input';
import { UPLOAD_BUCKET, uploadPath, type SubmittedFile } from '@/server/uploads/shared';
import { newUploadId, preparePage, PrepareError } from '@/app/ogrenci/yukle/gorsel';

interface Photo {
  key: string;
  file: File;
  preview: string | null;
}

/**
 * "Nereye kadar geldim?" (sade): Fotoğraf çek (birincil) · Yaz · boş sorularda "Hiç başlayamadım" / "Süre yetmedi".
 * Fotoğraflar tarayıcıda küçültülüp kendi klasörüne yüklenir; sunucu eylemi satırları yazar ve exam_how_far'ı çağırır.
 */
export function NeredenKadarGeldim({ sessionId, responseId, ownerId, blankable }: { sessionId: string; responseId: string; ownerId: string; blankable: boolean }) {
  const router = useRouter();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [writing, setWriting] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);
  const camera = useRef<HTMLInputElement>(null);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function addPhotos(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;
    setError(null);
    setPhotos((cur) => {
      const room = HOW_FAR_MAX_PHOTOS - cur.length;
      if (picked.length > room) setError(`En çok ${HOW_FAR_MAX_PHOTOS} fotoğraf gönderebilirsin.`);
      return [
        ...cur,
        ...picked.slice(0, Math.max(0, room)).map((file) => {
          const preview = file.type.startsWith('image/') && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
          if (preview) urls.current.push(preview);
          return { key: newUploadId(), file, preview };
        }),
      ];
    });
  }

  async function sendAll() {
    if (busy || (photos.length === 0 && text.trim() === '')) return;
    setBusy(true);
    setError(null);
    try {
      const files: SubmittedFile[] = [];
      if (photos.length > 0) {
        const supabase = createSupabaseBrowserClient();
        for (const p of photos) {
          const prepared = await preparePage(p.file);
          if (prepared.mime !== 'image/jpeg') throw new PrepareError('Yalnız fotoğraf ekleyebilirsin.');
          const path = uploadPath(ownerId, p.key, prepared.mime);
          const { error: upErr } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, prepared.blob, { contentType: prepared.mime, upsert: false });
          if (upErr && !/exists|duplicate/i.test(upErr.message)) throw new PrepareError('Fotoğraf yüklenemedi. Bağlantını kontrol edip yeniden dene.');
          files.push({ id: p.key, path, mime: prepared.mime, bytes: prepared.bytes, sha256: prepared.sha256, width: prepared.width, height: prepared.height, pages: null });
        }
      }
      const res = await sendHowFar({ sessionId, responseId, text, files });
      if (!res.ok) throw new PrepareError(res.error);
      router.push(res.href);
    } catch (err) {
      setError(err instanceof PrepareError ? err.message : 'Gönderemedim. Bağlantını kontrol edip yeniden dene.');
      setBusy(false);
    }
  }

  async function reason(value: 'not_started' | 'time') {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await sendBlankReason({ sessionId, responseId, reason: value });
    if (!res.ok) {
      setError(res.error);
      setBusy(false);
      return;
    }
    router.push(res.href);
  }

  const ready = photos.length > 0 || text.trim() !== '';
  return (
    <div className="flex flex-col gap-6">
      <input ref={camera} data-testid="nereye-kamera" type="file" accept="image/*" capture="environment" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={addPhotos} disabled={busy} />

      {photos.length > 0 ? (
        <ul aria-label="Eklenen fotoğraflar" className="m-0 grid list-none grid-cols-3 gap-3 p-0">
          {photos.map((p, i) => (
            <li key={p.key} className="relative aspect-[3/4] overflow-hidden rounded-md border border-line bg-surface-sunken">
              {p.preview ? (
                // eslint-disable-next-line @next/next/no-img-element -- yerel önizleme (blob: adresi)
                <img src={p.preview} alt={`${i + 1}. fotoğraf`} className="size-full object-cover" />
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => setPhotos((cur) => cur.filter((x) => x.key !== p.key))}
                aria-label={`${i + 1}. fotoğrafı çıkar`}
                className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-full bg-surface-raised/90 text-ink shadow-sm"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {writing ? (
        <div className="flex flex-col gap-2">
          <label htmlFor="nereye-yazi" className="text-label text-ink">
            Nereye kadar geldin?
          </label>
          <textarea
            id="nereye-yazi"
            value={text}
            maxLength={HOW_FAR_MAX_CHARS}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            className="text-body w-full rounded-md border border-line-strong bg-surface-raised p-3 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            placeholder="Yaptığın işlemleri kısaca yaz."
          />
        </div>
      ) : null}

      {error ? (
        <Notice tone="warning" live title="Gönderilemedi">
          {error}
        </Notice>
      ) : null}

      <div className="flex flex-col gap-3">
        {ready ? (
          <Button variant="primary" size="lg" block onClick={sendAll} disabled={busy} aria-busy={busy}>
            {busy ? 'Gönderiliyor' : 'Gönder'}
          </Button>
        ) : null}
        <button type="button" onClick={() => camera.current?.click()} disabled={busy || photos.length >= HOW_FAR_MAX_PHOTOS} className={buttonClasses({ variant: ready ? 'secondary' : 'primary', size: 'lg', block: true })}>
          <Camera aria-hidden="true" size={20} strokeWidth={1.75} /> {photos.length > 0 ? 'Fotoğraf ekle' : 'Fotoğraf çek'}
        </button>
        {!writing ? (
          <button type="button" onClick={() => setWriting(true)} disabled={busy} className={buttonClasses({ variant: 'secondary', size: 'lg', block: true })}>
            <PenLine aria-hidden="true" size={20} strokeWidth={1.75} /> Yaz
          </button>
        ) : null}
        {blankable ? (
          <div className="mt-2 flex flex-col gap-2">
            <button type="button" onClick={() => void reason('not_started')} disabled={busy} className={buttonClasses({ variant: 'quiet', size: 'lg', block: true })}>
              Hiç başlayamadım
            </button>
            <button type="button" onClick={() => void reason('time')} disabled={busy} className={buttonClasses({ variant: 'quiet', size: 'lg', block: true })}>
              Süre yetmedi
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
