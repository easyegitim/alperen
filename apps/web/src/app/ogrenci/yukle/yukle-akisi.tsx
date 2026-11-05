'use client';

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Check, ClipboardList, FileText, FileUp, NotebookPen, X } from 'lucide-react';
import { Button, Notice, buttonClasses, cn } from '@/ds';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { submitExam } from '@/server/exam-result/actions';
import { submitUploads } from '@/server/uploads/actions';
import { maxFilesFor, UPLOAD_BUCKET, UPLOAD_CHOICES, uploadPath, type SubmittedFile, type UploadKind } from '@/server/uploads/shared';
import { newUploadId, preparePage, PrepareError } from './gorsel';

interface Page {
  key: string;
  file: File;
  preview: string | null;
}

const KIND_ICON: Record<UploadKind, typeof NotebookPen> = { own_work: NotebookPen, school_exam: ClipboardList };

/**
 * Yükle (mockup S07): iki seçenek, "Fotoğraf çek" (kamera) ya da "Dosya/PDF seç", sonra tek "Gönder". Sayfalar
 * tarayıcıda küçültülüp doğrudan Storage'a (kendi klasörüne) gider; sunucu eylemi satırları yazar ve işi kuyruğa atar.
 */
export function YukleAkisi({ ownerId }: { ownerId: string }) {
  const uid = useId();
  const router = useRouter();
  const [kind, setKind] = useState<UploadKind>('own_work');
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const urls = useRef<string[]>([]);
  // Görünür düğmeler gizli dosya girdilerini açar (girdi odak almaz: klavye odağı ve halkası düğmede, WCAG 2.4.7)
  const kameraRef = useRef<HTMLInputElement>(null);
  const dosyaRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  function addFiles(e: ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;
    setError(null);
    setPages((cur) => {
      const max = maxFilesFor(kind);
      const room = max - cur.length;
      if (picked.length > room) setError(`En çok ${max} sayfa gönderebilirsin.`);
      const next = picked.slice(0, Math.max(0, room)).map((file) => {
        const preview = file.type.startsWith('image/') && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null;
        if (preview) urls.current.push(preview);
        return { key: newUploadId(), file, preview };
      });
      return [...cur, ...next];
    });
  }

  /** Tür değişince sayfa sınırı da değişir (Kendi çalışmam 4, Okul denemesi 40): fazlası bırakılır ve söylenir. */
  function chooseKind(next: UploadKind) {
    setKind(next);
    const max = maxFilesFor(next);
    if (pages.length > max) {
      setPages(pages.slice(0, max));
      setError(`Bu seçenekte en çok ${max} sayfa gönderebilirsin; fazlasını çıkardım.`);
    }
  }

  function removePage(key: string) {
    setPages((cur) => cur.filter((p) => p.key !== key));
  }

  async function send() {
    if (pages.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const files: SubmittedFile[] = [];
      for (const [i, page] of pages.entries()) {
        setProgress(`${pages.length} sayfadan ${i + 1}. gönderiliyor`);
        const prepared = await preparePage(page.file);
        const id = page.key;
        const path = uploadPath(ownerId, id, prepared.mime);
        const { error: upErr } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, prepared.blob, { contentType: prepared.mime, upsert: false });
        if (upErr && !/exists|duplicate/i.test(upErr.message)) throw new PrepareError('Sayfa yüklenemedi. Bağlantını kontrol edip yeniden dene.');
        files.push({ id, path, mime: prepared.mime, bytes: prepared.bytes, sha256: prepared.sha256, width: prepared.width, height: prepared.height, pages: null });
      }
      setProgress('Koçuna iletiliyor');
      // Okul denemesi: deneme kaydı + oturum + analiz işi (submit_exam_upload); Kendi çalışmam: teşhis (submit_upload)
      const res = kind === 'school_exam' ? await submitExam({ files }) : await submitUploads({ kind, files });
      if (!res.ok) {
        // sayfaların bir kısmı önceki (yanıtı kaybolmuş) gönderimde: yeni anahtarlar, bir sonraki Gönder yeni gönderim
        if (res.stale) setPages((cur) => cur.map((p) => ({ ...p, key: newUploadId() })));
        throw new PrepareError(res.error);
      }
      router.push(res.href);
    } catch (err) {
      setError(err instanceof PrepareError ? err.message : 'Gönderilemedi. Bağlantını kontrol edip yeniden dene.');
      setBusy(false);
      setProgress(null);
    }
  }

  const has = pages.length > 0;
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-8">
      <fieldset className="m-0 min-w-0 border-0 p-0" disabled={busy}>
        <legend className="p-0">
          <h1 className="text-title-1 m-0 text-ink">Ne yüklüyorsun?</h1>
        </legend>
        <div className="mt-8 flex flex-col gap-4">
          {UPLOAD_CHOICES.map((c) => {
            const Icon = KIND_ICON[c.value];
            const on = kind === c.value;
            return (
              <label
                key={c.value}
                data-testid={`tur-${c.value}`}
                className={cn(
                  'flex cursor-pointer items-center gap-4 rounded-lg border bg-surface-raised p-5 shadow-sm has-[:focus-visible]:shadow-focus-ring',
                  on ? 'border-primary ring-1 ring-primary' : 'border-line hover:border-line-strong',
                )}
              >
                <input type="radio" name={`${uid}-tur`} value={c.value} checked={on} onChange={() => chooseKind(c.value)} className="sr-only" />
                <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
                  <Icon size={24} strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-title-3 text-ink">{c.label}</span>
                  <span className="text-small text-ink-muted">{c.sub}</span>
                </span>
                <span
                  aria-hidden="true"
                  className={cn('flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px]', on ? 'border-primary bg-primary text-on-primary' : 'border-line-strong text-transparent')}
                >
                  <Check size={14} strokeWidth={2.5} />
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {has ? (
        <section aria-label="Eklenen sayfalar" className="flex flex-col gap-3">
          <p className="text-label m-0 text-ink">{pages.length} sayfa hazır</p>
          <ul className="m-0 grid list-none grid-cols-3 gap-3 p-0 sm:grid-cols-4">
            {pages.map((p, i) => (
              <li key={p.key} className="relative aspect-[3/4] overflow-hidden rounded-md border border-line bg-surface-sunken">
                {p.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element -- yerel önizleme (blob: adresi), optimize edilmez
                  <img src={p.preview} alt={`${i + 1}. sayfa`} className="size-full object-cover" />
                ) : (
                  <span className="text-small flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-ink-muted">
                    <FileText aria-hidden="true" size={24} />
                    <span className="line-clamp-2 break-all">{p.file.name}</span>
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removePage(p.key)}
                  disabled={busy}
                  aria-label={`${i + 1}. sayfayı çıkar`}
                  className="absolute top-1 right-1 flex size-11 items-center justify-center rounded-full bg-surface-raised/90 text-ink shadow-sm"
                >
                  <X aria-hidden="true" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? (
        <Notice tone="warning" live title="Gönderilemedi">
          {error}
        </Notice>
      ) : null}

      <div className="flex flex-col gap-3">
        <input ref={kameraRef} data-testid="kamera-girisi" type="file" accept="image/*" capture="environment" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={addFiles} disabled={busy} />
        <input ref={dosyaRef} data-testid="dosya-girisi" type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={addFiles} disabled={busy} />
        {has ? (
          <>
            <Button variant="primary" size="lg" block onClick={send} disabled={busy} aria-busy={busy}>
              {busy ? (progress ?? 'Gönderiliyor') : 'Gönder'}
            </Button>
            <div className="flex justify-center gap-2">
              <button type="button" onClick={() => kameraRef.current?.click()} disabled={busy} className={buttonClasses({ variant: 'quiet', size: 'md' })}>
                <Camera aria-hidden="true" size={18} /> Fotoğraf ekle
              </button>
              <button type="button" onClick={() => dosyaRef.current?.click()} disabled={busy} className={buttonClasses({ variant: 'quiet', size: 'md' })}>
                <FileUp aria-hidden="true" size={18} /> Dosya ekle
              </button>
            </div>
          </>
        ) : (
          <>
            <button type="button" onClick={() => kameraRef.current?.click()} className={buttonClasses({ variant: 'primary', size: 'lg', block: true })}>
              <Camera aria-hidden="true" size={20} strokeWidth={1.75} /> Fotoğraf çek
            </button>
            <button type="button" onClick={() => dosyaRef.current?.click()} className={buttonClasses({ variant: 'secondary', size: 'lg', block: true })}>
              <FileUp aria-hidden="true" size={20} strokeWidth={1.75} /> Dosya/PDF seç
            </button>
          </>
        )}
        <p className="text-small m-0 mt-2 text-center text-ink-muted">Gerisini Öğrenmen halleder; sonucu Bugün’de görürsün.</p>
      </div>
    </div>
  );
}
