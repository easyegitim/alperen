'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, cn } from '@/ds';
import { DocumentViewer } from '@/components/pdf';
import { kindWord } from '@/server/documents/review-present';
import type { ReviewItem } from '@/server/documents/review';

type Decide = (documentId: string, decision: 'approve' | 'reject', note: string) => Promise<{ ok: boolean; message: string }>;

const TONE: Record<string, string> = {
  pass: 'bg-success-soft text-success',
  fail: 'bg-danger-soft text-danger',
  neutral: 'bg-surface-sunken text-ink-muted',
};

/**
 * Eğitmen inceleme kuyruğu (yoğun): solda bekleyen belgeler, sağda PDF önizleme + doğrulama özeti (kelimeyle) +
 * not + Onayla / Reddet. Karar `review_document` RPC'sidir; onaylanan belge öğrenciye Bugün kartı olarak gider.
 */
export function ReviewQueue({ items: all, decide }: { items: ReviewItem[]; decide: Decide }) {
  const router = useRouter();
  const [decided, setDecided] = useState<string[]>([]);
  const [confirmReject, setConfirmReject] = useState(false);
  const items = all.filter((i) => !decided.includes(i.id));
  const [selected, setSelected] = useState(items[0]?.id ?? null);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const current = items.find((i) => i.id === selected) ?? items[0] ?? null;

  function submit(decision: 'approve' | 'reject') {
    if (!current) return;
    if (decision === 'reject' && !confirmReject) {
      setConfirmReject(true);
      return;
    }
    setConfirmReject(false);
    start(async () => {
      const res = await decide(current.id, decision, note);
      setMessage({ ok: res.ok, text: res.message });
      if (res.ok) {
        setNote('');
        setDecided((d) => [...d, current.id]);
        setSelected(null);
        router.refresh();
      }
    });
  }

  if (!current) {
    return message ? (
      <p role="status" className={cn('text-small m-0', message.ok ? 'text-success' : 'text-danger')}>
        {message.text}
      </p>
    ) : null;
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]" data-testid="inceleme-kuyrugu">
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="İncelenecek belgeler">
        {items.map((i) => (
          <li key={i.id}>
            <button
              type="button"
              aria-current={i.id === current.id}
              onClick={() => {
                // Not belgeye aittir: başka belgeye geçince sıfırlanır (A'ya yazılan not B'nin kararına gitmesin).
                setSelected(i.id);
                setNote('');
                setConfirmReject(false);
                setMessage(null);
              }}
              className={cn(
                'box-border flex min-h-14 w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                i.id === current.id ? 'border-primary bg-primary-soft' : 'border-line bg-surface-raised hover:bg-surface-sunken',
              )}
            >
              <span className="text-label">{i.title}</span>
              <span className="text-caption text-ink-muted">
                {kindWord(i.kind)} · {i.scope === 'course' ? (i.courseTitle ?? 'Ders geneli') : 'Öğrenciye özel'}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <section aria-labelledby="inceleme-baslik" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="inceleme-baslik" className="text-title-3 m-0 text-ink">
            {current.title}
          </h2>
          <p className="text-small m-0 text-ink-muted">
            {kindWord(current.kind)} · {current.scope === 'course' ? 'Ders geneli; onaylayınca derse kayıtlı herkese gider' : 'Öğrenciye özel'}
          </p>
        </div>

        <ul aria-label="Kontroller" className="m-0 flex list-none flex-wrap gap-2 p-0" data-testid="dogrulama">
          {current.steps.map((s) => (
            <li key={s.step} className={cn('text-small rounded-full px-3 py-1', TONE[s.tone])} title={s.note ?? undefined}>
              {s.label}: {s.word}
            </li>
          ))}
          {current.regenerated > 0 ? <li className="text-small rounded-full bg-surface-sunken px-3 py-1 text-ink-muted">{current.regenerated} blok yeniden üretildi</li> : null}
        </ul>
        {current.warning ? (
          <p role="alert" className="text-small m-0 rounded-md bg-danger-soft px-3 py-2 text-danger">
            {current.warning}
          </p>
        ) : null}

        <div className="rounded-lg border border-line bg-surface-raised p-3">
          {current.src ? (
            <DocumentViewer key={current.id} src={current.src} title={current.title} />
          ) : (
            <p className="text-small m-0 text-ink-muted">PDF önizlemesi yok.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="inceleme-not" className="text-label text-ink">
            Not (isteğe bağlı)
          </label>
          <textarea
            id="inceleme-not"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="text-body box-border w-full resize-y rounded-md border border-line bg-surface-raised p-3 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          />
          {message ? (
            <p role="status" className={cn('text-small m-0', message.ok ? 'text-success' : 'text-danger')}>
              {message.text}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" onClick={() => submit('approve')} disabled={pending}>
              Onayla
            </Button>
            <Button variant="secondary" onClick={() => submit('reject')} disabled={pending}>
              {confirmReject ? 'Reddi onayla' : 'Reddet'}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
