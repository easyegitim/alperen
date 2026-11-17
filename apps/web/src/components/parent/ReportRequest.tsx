'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/ds';
import { REPORT_KINDS, type ReportKind } from '@/lib/parent';
import { requestReportAction, type ReportState } from '@/app/veli/actions';

/**
 * "Rapor iste" (Özet, sessiz düğme): tür seçimi tek satır, dört çip (Haftalık · Deneme · Konu · Trend). Konu seçilince kısa bir
 * metin alanı açılır. Gönderince tek satır durum: "Raporu hazırlıyorum; hazır olunca haber vereceğim." Günlük sınır dolarsa nazik uyarı.
 */
export function ReportRequest({ studentId, action = requestReportAction }: { studentId: string; action?: typeof requestReportAction }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind>('weekly');
  const [topic, setTopic] = useState('');
  const [state, setState] = useState<ReportState>({});
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      setState({});
      setState(await action(studentId, kind, kind === 'topic' ? topic : null));
    });

  return (
    <div className="flex flex-col gap-3">
      <Button variant="quiet" size="lg" block aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="rapor-iste">
        Rapor iste
      </Button>
      {open ? (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4">
          <div role="radiogroup" aria-label="Rapor türü" className="flex flex-wrap gap-2">
            {REPORT_KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                role="radio"
                aria-checked={kind === k.kind}
                onClick={() => setKind(k.kind)}
                className="text-small min-h-10 cursor-pointer rounded-full border border-line bg-surface px-4 text-ink hover:bg-surface-sunken focus-visible:outline-none focus-visible:shadow-focus-ring aria-checked:border-primary aria-checked:bg-primary-soft aria-checked:text-primary"
              >
                {k.label}
              </button>
            ))}
          </div>
          {kind === 'topic' ? (
            <label className="flex flex-col gap-1">
              <span className="text-small text-ink-muted">Hangi konu?</span>
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                maxLength={120}
                placeholder="Örneğin rasyonel sayılar"
                className="min-h-11 rounded-md border border-line bg-surface px-3 text-[16px] text-ink focus-visible:outline-none focus-visible:shadow-focus-ring"
              />
            </label>
          ) : null}
          <div>
            <Button variant="secondary" onClick={submit} disabled={pending}>
              {pending ? 'İstek gönderiliyor' : 'İste'}
            </Button>
          </div>
        </div>
      ) : null}
      <p role="status" className="text-small m-0 min-h-5 text-ink-muted" data-testid="rapor-durum">
        {state.message ?? ''}
      </p>
    </div>
  );
}
