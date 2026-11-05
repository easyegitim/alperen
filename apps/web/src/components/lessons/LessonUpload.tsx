'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, X } from 'lucide-react';
import { Button, Notice, ProgressBar, TextField, buttonClasses, cn } from '@/ds';
import { SelectField } from '@/components/SelectField';
import { newUploadId } from '@/app/ogrenci/yukle/gorsel';
import { tusUpload, UploadAborted } from '@/lib/lesson-upload';
import { LESSON_ACCEPT, checkLessonFile, formatBytes, lessonObjectPath, type LessonFileInfo } from '@/server/lessons/shared';
import type { LessonTarget } from '@/server/lessons/read';
import type { LessonActionResult } from '@/app/egitmen/dersler/actions';

type Register = (input: unknown) => Promise<LessonActionResult>;

interface Picked {
  file: File;
  info: LessonFileInfo;
  uploadId: string;
}

/** Yerel tarih-saat alanı değeri ("2026-10-29T17:00") → ISO; boşsa null. */
function localToIso(v: string): string | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Ders yükle (S14): öğrenci + ders seçimi, video/ses/transkript dosyası (≤ 5 GB, Uppy + Supabase TUS ile kaldığı yerden
 * sürer), isteğe bağlı başlık ve ders zamanı. Video/ses seçildiyse ayrıca bir transkript dosyası eklenebilir (bu durumda
 * yazıya çevirme atlanır). Bitince sunucu eylemi `uploads` satırını yazar ve register_lesson ile dersi açar.
 */
export function LessonUpload({ targets, ownerId, register, onDone }: { targets: LessonTarget[]; ownerId: string; register: Register; onDone?: (lessonId?: string) => void }) {
  const router = useRouter();
  const mainInput = useRef<HTMLInputElement>(null);
  const trInput = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  const students = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of targets) m.set(t.studentId, t.studentName);
    return [...m].map(([value, label]) => ({ value, label }));
  }, [targets]);
  const [studentId, setStudentId] = useState(students.length === 1 ? students[0]!.value : '');
  const courses = useMemo(() => targets.filter((t) => t.studentId === studentId).map((t) => ({ value: t.enrollmentId, label: t.courseTitle })), [targets, studentId]);
  const [enrollmentId, setEnrollmentId] = useState('');
  const effectiveEnrollment = courses.some((c) => c.value === enrollmentId) ? enrollmentId : courses.length === 1 ? courses[0]!.value : '';
  const [title, setTitle] = useState('');
  const [heldAt, setHeldAt] = useState('');
  const [main, setMain] = useState<Picked | null>(null);
  const [transcript, setTranscript] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [total, setTotal] = useState(0);
  const [phase, setPhase] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  function pick(list: FileList | null, as: 'main' | 'transcript') {
    const file = list?.[0];
    const el = as === 'main' ? mainInput.current : trInput.current;
    if (el) el.value = '';
    if (!file) return;
    const chk = checkLessonFile(file);
    if (!chk.ok) return setNote({ ok: false, text: chk.message });
    if (as === 'transcript' && chk.info.kind !== 'transcript') return setNote({ ok: false, text: 'Buraya bir transkript dosyası (txt, vtt, srt) ekle.' });
    setNote(null);
    const picked = { file, info: chk.info, uploadId: newUploadId() };
    if (as === 'main') {
      setMain(picked);
      if (picked.info.kind === 'transcript') setTranscript(null);
    } else setTranscript(picked);
  }

  const ready = Boolean(main && effectiveEnrollment);

  async function send() {
    if (busy || !main || !effectiveEnrollment) return;
    setBusy(true);
    setNote(null);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const files = [main, ...(transcript && main.info.kind !== 'transcript' ? [transcript] : [])];
      const grand = files.reduce((n, f) => n + f.file.size, 0);
      setTotal(grand);
      let done = 0;
      for (const [i, f] of files.entries()) {
        setPhase(files.length > 1 ? `${files.length} dosyadan ${i + 1}. gönderiliyor` : 'Gönderiliyor');
        await tusUpload({
          file: f.file,
          objectName: lessonObjectPath(ownerId, f.uploadId, f.info.ext),
          contentType: f.info.mime,
          signal: ctl.signal,
          onProgress: (s) => setSent(done + s),
        });
        done += f.file.size;
        setSent(done);
      }
      setPhase('Kaydediliyor');
      const withTr = transcript && main.info.kind !== 'transcript' ? transcript : null;
      const res = await register({
        uploadId: main.uploadId,
        path: lessonObjectPath(ownerId, main.uploadId, main.info.ext),
        mime: main.info.mime,
        bytes: main.file.size,
        kind: main.info.kind,
        enrollmentId: effectiveEnrollment,
        title,
        heldAt: localToIso(heldAt),
        transcript: withTr ? { uploadId: withTr.uploadId, path: lessonObjectPath(ownerId, withTr.uploadId, withTr.info.ext), mime: withTr.info.mime, bytes: withTr.file.size } : null,
      });
      if (!res.ok) return setNote({ ok: false, text: res.message });
      setNote({ ok: true, text: res.message });
      setMain(null);
      setTranscript(null);
      setTitle('');
      setHeldAt('');
      router.refresh();
      onDone?.(res.lessonId);
    } catch (err) {
      setNote({ ok: false, text: err instanceof UploadAborted ? 'Yükleme durduruldu.' : 'Gönderilemedi. Bağlantını kontrol edip yeniden dene; yükleme kaldığı yerden sürer.' });
    } finally {
      abort.current = null;
      setBusy(false);
      setPhase(null);
    }
  }

  if (targets.length === 0) {
    return (
      <Notice tone="info">
        Ders yüklemek için sana bağlı, bir derse kayıtlı öğrenci gerekir. Öğrenci seni eğitmeni olarak eklediğinde burada seçebilirsin.
      </Notice>
    );
  }

  return (
    <section aria-label="Ders yükle" data-testid="ders-yukle" className="flex flex-col gap-4 rounded-lg border border-line bg-surface-raised p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Öğrenci" value={studentId} onChange={(e) => setStudentId(e.target.value)} options={students} placeholder="Öğrenci seç" disabled={busy} data-testid="ders-ogrenci" />
        <SelectField label="Ders" value={effectiveEnrollment} onChange={(e) => setEnrollmentId(e.target.value)} options={courses} placeholder={studentId ? 'Ders seç' : 'Önce öğrenci seç'} disabled={busy || !studentId} data-testid="ders-kayit" />
        <TextField label="Başlık (isteğe bağlı)" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} disabled={busy} />
        <TextField label="Ders zamanı (isteğe bağlı)" type="datetime-local" value={heldAt} onChange={(e) => setHeldAt(e.target.value)} disabled={busy} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={mainInput} data-testid="ders-dosya" type="file" accept={LESSON_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => pick(e.target.files, 'main')} disabled={busy} />
        <input ref={trInput} data-testid="ders-transkript" type="file" accept=".txt,.vtt,.srt,.json,.jsonl" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => pick(e.target.files, 'transcript')} disabled={busy} />
        <Button variant="secondary" onClick={() => mainInput.current?.click()} disabled={busy} icon={<FileUp size={18} />}>
          Video, ses ya da transkript seç
        </Button>
        {main && main.info.kind !== 'transcript' ? (
          <Button variant="quiet" onClick={() => trInput.current?.click()} disabled={busy}>
            Transkript dosyası ekle
          </Button>
        ) : null}
      </div>
      {main ? (
        <ul aria-label="Seçilen dosyalar" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {[main, transcript].filter((p): p is Picked => Boolean(p)).map((p) => (
            <li key={p.uploadId} className="text-small flex min-h-9 items-center gap-1 rounded-md bg-surface-sunken pr-1 pl-3 text-ink">
              <span className="max-w-64 truncate">{p.file.name}</span>
              <span className="text-ink-muted">{formatBytes(p.file.size)}</span>
              <button
                type="button"
                aria-label={`${p.file.name} dosyasını çıkar`}
                disabled={busy}
                onClick={() => (p === main ? (setMain(null), setTranscript(null)) : setTranscript(null))}
                className="flex size-9 items-center justify-center rounded-md text-ink-muted hover:text-ink"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small m-0 text-ink-muted">En çok 5 GB. Yükleme kesilirse kaldığı yerden sürer; sayfayı kapatma.</p>
      )}
      {busy ? <ProgressBar value={sent} max={Math.max(total, 1)} label={phase ?? 'Gönderiliyor'} showValue={false} className="w-full" data-testid="ders-yukleme-cubugu" /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={send} disabled={busy || !ready} aria-busy={busy}>
          {busy ? (phase ?? 'Gönderiliyor') : 'Dersi yükle'}
        </Button>
        {busy ? (
          <Button variant="quiet" onClick={() => abort.current?.abort()}>
            Durdur
          </Button>
        ) : null}
      </div>
      {note ? (
        <Notice tone={note.ok ? 'info' : 'warning'} live>
          {note.text}
        </Notice>
      ) : null}
    </section>
  );
}

/** Katlı sarmalayıcı: "Ders yükle" düğmesi formu açar (sunucu sayfasında `buttonClasses` çağrılamaz). */
export function LessonUploadPanel({ open, ...props }: { open: boolean; targets: LessonTarget[]; ownerId: string; register: Register }) {
  return (
    <details className="group" open={open || undefined} data-testid="ders-yukle-katli">
      <summary className={cn(buttonClasses({ variant: 'primary', size: 'md' }), 'w-fit list-none [&::-webkit-details-marker]:hidden')}>Ders yükle</summary>
      <div className="mt-3">
        <LessonUpload {...props} />
      </div>
    </details>
  );
}
