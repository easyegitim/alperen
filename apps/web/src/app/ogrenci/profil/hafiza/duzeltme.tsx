'use client';

import { useState } from 'react';
import { Badge, Button, Notice } from '@/ds';
import { requestMemoryCorrection } from '@/server/memory-correction/actions';
import { CORRECTION_MAX_CHARS, CORRECTION_STATUS_LABEL } from '@/server/memory-correction/input';
import type { MemoryCorrection } from '@/server/queries';

const TONE = { open: 'neutral', applied: 'success', rejected: 'warning' } as const;

/** "Düzeltme iste": tek birincil düğme → kısa metin kutusu → gönder; altında son 3 istek ve durumu. */
export function DuzeltmeIste({ recent }: { recent: MemoryCorrection[] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await requestMemoryCorrection({ text });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setText('');
    setOpen(false);
    setSent(true);
  }

  return (
    <section aria-labelledby="duzeltme-baslik" className="flex flex-col gap-3">
      <h2 id="duzeltme-baslik" className="text-title-2 m-0 text-ink">
        Yanlış ya da eksik bir şey mi var?
      </h2>
      {sent ? (
        <Notice tone="info" live>
          İsteğini aldım; birkaç dakika içinde güncellenir.
        </Notice>
      ) : null}
      {open ? (
        <form onSubmit={submit} className="flex flex-col gap-2" noValidate>
          <label htmlFor="duzeltme-metin" className="text-label text-ink">
            Neyi düzeltelim?
          </label>
          <textarea
            id="duzeltme-metin"
            value={text}
            maxLength={CORRECTION_MAX_CHARS}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="text-body w-full rounded-md border border-line-strong bg-surface-raised p-3 text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            placeholder="Örnek: Matematikte geometri değil cebir zayıfım."
          />
          <p className="text-caption m-0 text-ink-muted">
            {text.length}/{CORRECTION_MAX_CHARS}
          </p>
          {error ? (
            <Notice tone="warning" live title="Gönderilemedi">
              {error}
            </Notice>
          ) : null}
          <div className="flex gap-3">
            <Button type="submit" variant="primary" disabled={busy || text.trim() === ''} aria-busy={busy}>
              {busy ? 'Gönderiliyor' : 'Gönder'}
            </Button>
            <Button type="button" variant="quiet" disabled={busy} onClick={() => setOpen(false)}>
              Vazgeç
            </Button>
          </div>
        </form>
      ) : (
        <div>
          <Button type="button" variant="primary" onClick={() => { setOpen(true); setSent(false); }}>
            Düzeltme iste
          </Button>
        </div>
      )}
      {recent.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Son düzeltme isteklerin">
          {recent.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 rounded-md border border-line p-3">
              <div className="flex items-start justify-between gap-3">
                <span className="text-body text-ink">{r.text}</span>
                <Badge tone={TONE[r.status]}>{CORRECTION_STATUS_LABEL[r.status]}</Badge>
              </div>
              {r.resolution_note ? <span className="text-caption text-ink-muted">{r.resolution_note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
