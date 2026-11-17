'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, X } from 'lucide-react';
import { Button, Notice, TextField, buttonClasses, cn } from '@/ds';
import { SelectField } from '@/components/SelectField';
import { newUploadId, preparePage, PrepareError } from '@/app/ogrenci/yukle/gorsel';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { ARCHIVE_LIMITS, EXAM_TERMS, type ExamFileMeta, type ExamTerm } from '@/server/styles/shared';
import { UPLOAD_BUCKET, uploadPath } from '@/server/uploads/shared';

type Ingest = (input: unknown) => Promise<{ ok: boolean; message: string; stale?: true }>;

interface Picked {
  key: string;
  file: File;
}

/**
 * Çıkmış sınav yükle (S13): yıl + tür + çoklu PDF/fotoğraf. Dosyalar tarayıcıda hazırlanıp eğitmenin kendi Storage
 * klasörüne gider; sunucu eylemi `uploads` satırlarını yazar ve ingest_exam_source ile `style.ingest` işini kuyruğa atar.
 */
export function ArchiveUpload({ courseId, ownerId, ingest, onDone }: { courseId: string; ownerId: string; ingest: Ingest; onDone?: () => void }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [term, setTerm] = useState<ExamTerm>('osym');
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  function add(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (input.current) input.current.value = '';
    if (files.length === 0) return;
    setNote(null);
    setPicked((cur) => {
      const room = ARCHIVE_LIMITS.maxFiles - cur.length;
      if (files.length > room) setNote({ ok: false, text: `En çok ${ARCHIVE_LIMITS.maxFiles} dosya gönderebilirsin.` });
      return [...cur, ...files.slice(0, Math.max(0, room)).map((file) => ({ key: newUploadId(), file }))];
    });
  }

  async function send() {
    if (busy || picked.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const supabase = createSupabaseBrowserClient();
      const files: ExamFileMeta[] = [];
      for (const [i, p] of picked.entries()) {
        setProgress(`${picked.length} dosyadan ${i + 1}. gönderiliyor`);
        const prepared = await preparePage(p.file);
        const path = uploadPath(ownerId, p.key, prepared.mime);
        const { error } = await supabase.storage.from(UPLOAD_BUCKET).upload(path, prepared.blob, { contentType: prepared.mime, upsert: false });
        if (error && !/exists|duplicate/i.test(error.message)) throw new PrepareError('Dosya yüklenemedi. Bağlantını kontrol edip yeniden dene.');
        files.push({ id: p.key, path, mime: prepared.mime, bytes: prepared.bytes, sha256: prepared.sha256, width: prepared.width, height: prepared.height });
      }
      setProgress('Kaydediliyor');
      const res = await ingest({ courseId, year: Number(year), term, files });
      if (!res.ok) {
        if (res.stale) setPicked((cur) => cur.map((p) => ({ ...p, key: newUploadId() })));
        setNote({ ok: false, text: res.message });
        return;
      }
      setNote({ ok: true, text: res.message });
      setPicked([]);
      router.refresh();
      onDone?.();
    } catch (err) {
      setNote({ ok: false, text: err instanceof PrepareError ? err.message : 'Gönderilemedi. Bağlantını kontrol edip yeniden dene.' });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <section aria-label="Çıkmış sınav yükle" data-testid="arsiv-yukle" className="flex flex-col gap-4 rounded-lg border border-line bg-surface-raised p-4">
      <div className="grid gap-3 sm:grid-cols-[8rem_12rem_1fr] sm:items-end">
        <TextField label="Sınav yılı" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} disabled={busy} />
        <SelectField label="Sınav türü" value={term} onChange={(e) => setTerm(e.target.value as ExamTerm)} options={EXAM_TERMS.map((t) => ({ value: t.value, label: t.label }))} disabled={busy} />
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} data-testid="arsiv-dosya" type="file" accept="image/*,application/pdf" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => add(e.target.files)} disabled={busy} />
          <Button variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
            <FileUp aria-hidden="true" size={18} /> PDF veya fotoğraf seç
          </Button>
          <Button variant="primary" onClick={send} disabled={busy || picked.length === 0} aria-busy={busy}>
            {busy ? (progress ?? 'Gönderiliyor') : 'Yükle'}
          </Button>
        </div>
      </div>
      {picked.length > 0 ? (
        <ul aria-label="Seçilen dosyalar" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {picked.map((p) => (
            <li key={p.key} className="text-small flex min-h-9 items-center gap-1 rounded-md bg-surface-sunken pr-1 pl-3 text-ink">
              <span className="max-w-48 truncate">{p.file.name}</span>
              <button type="button" aria-label={`${p.file.name} dosyasını çıkar`} disabled={busy} onClick={() => setPicked((cur) => cur.filter((x) => x.key !== p.key))} className="flex size-9 items-center justify-center rounded-md text-ink-muted hover:text-ink">
                <X aria-hidden="true" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small m-0 text-ink-muted">Bir sınavın tüm sayfalarını aynı anda seç; en çok {ARCHIVE_LIMITS.maxFiles} dosya. Soru metni öğrencilere gösterilmez.</p>
      )}
      {note ? (
        <Notice tone={note.ok ? 'info' : 'warning'} live>
          {note.text}
        </Notice>
      ) : null}
    </section>
  );
}

/** Katlı sarmalayıcı: "Çıkmış sınav yükle" düğmesi formu açar (sunucu sayfasında `buttonClasses` çağrılamaz). */
export function ArchiveUploadPanel({ open, ...props }: { open: boolean; courseId: string; ownerId: string; ingest: Ingest }) {
  return (
    <details className="group" open={open || undefined}>
      <summary className={cn(buttonClasses({ variant: 'primary', size: 'md' }), 'w-fit list-none [&::-webkit-details-marker]:hidden')}>Çıkmış sınav yükle</summary>
      <div className="mt-3">
        <ArchiveUpload {...props} />
      </div>
    </details>
  );
}
