import type { ComponentPropsWithRef, ReactNode } from 'react';
import { BookOpenCheck, ClipboardCheck, FileText, Search, Target, Upload, Repeat } from 'lucide-react';
import { cn } from '../lib/cn';
import { Badge } from './Badge';
import { Button, buttonClasses } from './Button';

/** suggestions.kind ile aynı değerler (PLAN-v2-detail §6). */
export type SuggestionKind =
  | 'practice'
  | 'weekly_homework'
  | 'lesson_review'
  | 'gap_analysis'
  | 'mini_exam'
  | 'document_ready'
  | 'upload_result';

export const SUGGESTION_KIND_LABELS: Record<SuggestionKind, string> = {
  practice: 'Alıştırma',
  weekly_homework: 'Haftalık ödev',
  lesson_review: 'Ders tekrarı',
  gap_analysis: 'Eksik analizi',
  mini_exam: 'Mini deneme',
  document_ready: 'Belge hazır',
  upload_result: 'Yükleme sonucu',
};

/** Eylem düğmesi metni: test başlatanlar "Başla", belge ve sonuç kartları "Aç". */
export const SUGGESTION_ACTION_LABELS: Record<SuggestionKind, string> = {
  practice: 'Başla',
  weekly_homework: 'Başla',
  lesson_review: 'Başla',
  gap_analysis: 'Başla',
  mini_exam: 'Başla',
  document_ready: 'Aç',
  upload_result: 'Aç',
};

const ICONS: Record<SuggestionKind, ReactNode> = {
  practice: <Target size={20} />,
  weekly_homework: <ClipboardCheck size={20} />,
  lesson_review: <Repeat size={20} />,
  gap_analysis: <Search size={20} />,
  mini_exam: <BookOpenCheck size={20} />,
  document_ready: <FileText size={20} />,
  upload_result: <Upload size={20} />,
};

export interface SuggestionCardProps extends Omit<ComponentPropsWithRef<'article'>, 'title'> {
  kind: SuggestionKind;
  /** Tek cümlelik kart metni. */
  title: string;
  subtitle?: string;
  /** "12 dk" gibi süre tahmini (sayı kelimeyle birlikte yazılır). */
  durationText?: string;
  /** Tıklanınca başlatır. href verilirse düğme yerine bağlantı çizilir. */
  onStart?: () => void;
  href?: string;
  /** Eylem metnini değiştirir (varsayılan kind'a göre "Başla" / "Aç"). */
  actionLabel?: string;
  /** Başlık düzeyi (varsayılan 3). */
  headingLevel?: 2 | 3 | 4;
}

/** Bugün ekranındaki öneri kutusu: tür etiketi, tek cümle, süre ve tek dokunuşla başlatan eylem. */
export function SuggestionCard({
  kind,
  title,
  subtitle,
  durationText,
  onStart,
  href,
  actionLabel,
  headingLevel = 3,
  className,
  ...rest
}: SuggestionCardProps) {
  const Heading = `h${headingLevel}` as const;
  const label = actionLabel ?? SUGGESTION_ACTION_LABELS[kind];
  const kindLabel = SUGGESTION_KIND_LABELS[kind];
  const aria = `${label}: ${title}`;
  return (
    <article
      data-kind={kind}
      {...rest}
      className={cn('flex w-full flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <Badge tone={kind === 'document_ready' || kind === 'upload_result' ? 'ai' : 'primary'}>
          <span aria-hidden="true" className="inline-flex">
            {ICONS[kind]}
          </span>
          {kindLabel}
        </Badge>
        {durationText ? <span className="text-small text-ink-muted">{durationText}</span> : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <Heading className="text-title-3 m-0 text-ink">{title}</Heading>
        {subtitle ? <p className="text-small m-0 text-ink-muted">{subtitle}</p> : null}
      </div>
      {href ? (
        <a href={href} aria-label={aria} className={cn(buttonClasses({ variant: 'secondary' }), 'self-start')}>
          {label}
        </a>
      ) : (
        <Button variant="secondary" aria-label={aria} onClick={onStart} className="self-start">
          {label}
        </Button>
      )}
    </article>
  );
}
