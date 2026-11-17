import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { documentLine, type Band, type TopicRow } from '@/server/progress/present';
import { documentHref } from '@/server/documents/present';
import type { DocumentItem } from '@/server/progress/read';

// Gelişim ekranının (mockup S08) sunucuda çizilen parçaları: üç sayı, katlı bölümler, bant rozeti, belge satırı.

export function Stat({ value, unit, label }: { value: string; unit: string; label: string }) {
  return (
    <div className="box-border flex min-w-0 flex-col-reverse gap-1 rounded-lg border border-line bg-surface-raised px-3 py-4">
      <dt className="text-small flex flex-col text-ink-muted">
        <span className="font-medium text-ink">{unit}</span>
        <span>{label}</span>
      </dt>
      <dd className={cn('m-0 text-ink tabular-nums', /^[\d.,]+$/.test(value) ? 'text-title-2' : 'text-body py-1 font-semibold')}>{value}</dd>
    </div>
  );
}

const BAND_CLASS: Record<'low' | 'mid' | 'high' | 'none', string> = {
  high: 'bg-success-soft text-success',
  mid: 'bg-warning-soft text-warning',
  low: 'bg-danger-soft text-danger',
  none: 'bg-surface-sunken text-ink-muted',
};

export function BandPill({ band, word }: { band: Band; word: string }) {
  return <span className={cn('text-small box-border min-w-16 shrink-0 rounded-full px-3 py-0.5 text-center font-medium', BAND_CLASS[band ?? 'none'])}>{word}</span>;
}

export function Fold({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <details className="group rounded-lg border border-line bg-surface-raised" data-testid={testId}>
      <summary className="text-body flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-5 font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <ChevronDown aria-hidden="true" size={20} className="shrink-0 text-ink-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-5 pb-3">{children}</div>
    </details>
  );
}

export function TopicList({ topics }: { topics: TopicRow[] }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {topics.map((t) => (
        <li key={t.skillId} className="flex min-h-13 items-center justify-between gap-3 border-t border-line">
          <span className="text-label font-normal text-ink">{t.name}</span>
          <BandPill band={t.band} word={t.word} />
        </li>
      ))}
    </ul>
  );
}

export function DocumentList({ documents }: { documents: DocumentItem[] }) {
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {documents.map((d) => (
        <li key={d.id} className="flex border-t border-line">
          <Link href={documentHref(d.id)} className="flex min-h-13 flex-1 items-center justify-between gap-3 rounded-md text-ink no-underline">
            <span className="text-label font-normal">{documentLine(d.title, d.kind)}</span>
            <ChevronRight aria-hidden="true" size={20} className="shrink-0 text-ink-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
