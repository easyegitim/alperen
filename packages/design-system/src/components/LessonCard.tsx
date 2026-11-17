import { createElement } from 'react';
import type { HTMLAttributes, Ref } from 'react';
import { cn, FOCUS_RING } from '../lib/cn';
import { Badge } from './Badge';
import { ProgressBar } from './ProgressBar';

export type LessonStatus = 'not-started' | 'in-progress' | 'done';

const STATUS_LABEL: Record<LessonStatus, string> = {
  'not-started': 'Başlanmadı',
  'in-progress': 'Devam ediyor',
  done: '✓ Tamamlandı',
};

export interface LessonCardProps extends Omit<HTMLAttributes<HTMLElement>, 'title' | 'onClick'> {
  title: string;
  /** BÜYÜK HARF, Türkçe İ ile ("MATEMATİK"). */
  subject?: string;
  /** "12 dk · 8 soru". */
  meta?: string;
  /** 0–100. */
  progress?: number;
  status?: LessonStatus;
  /** Ders Öğrenmen tarafından kişiye özel hazırlandıysa: hologram ışıması ve açıklama satırı. */
  ai?: boolean;
  href?: string;
  onClick?: () => void;
  ref?: Ref<HTMLElement>;
}

/** Ders listesindeki tek ders. href verilirse bağlantı, onClick verilirse düğme, ikisi de yoksa makale olur. */
export function LessonCard({
  title,
  subject,
  meta,
  progress,
  status = 'not-started',
  ai,
  href,
  onClick,
  className,
  ref,
  ...rest
}: LessonCardProps) {
  const interactive = !!href || !!onClick;
  const tag = href ? 'a' : onClick ? 'button' : 'article';
  const classes = cn(
    'box-border flex w-full max-w-70 flex-col gap-2 rounded-lg border border-line bg-surface-raised p-4 text-left font-[inherit] text-ink no-underline',
    ai ? 'shadow-ai' : 'shadow-sm',
    interactive && 'og-motion cursor-pointer transition-shadow duration-150 hover:border-line-strong hover:shadow-lg',
    interactive && FOCUS_RING,
    className,
  );
  return createElement(
    tag,
    { ...rest, ref, href, onClick, type: tag === 'button' ? 'button' : undefined, className: classes },
    <span className="flex items-center justify-between gap-2">
      <span className="text-caption text-ink-muted">{subject}</span>
      <Badge tone={status === 'done' ? 'success' : status === 'in-progress' ? 'primary' : 'neutral'}>{STATUS_LABEL[status]}</Badge>
    </span>,
    <span className="text-title-3">{title}</span>,
    meta ? (
      <span className="text-small text-ink-muted">{meta}</span>
    ) : null,
    typeof progress === 'number' && tag !== 'button' ? (
      <ProgressBar value={progress} label="İlerleme" tone={status === 'done' ? 'gold' : 'primary'} />
    ) : null,
    typeof progress === 'number' && tag === 'button' ? (
      // <button> yalnızca phrasing içerik alır; ProgressBar (div) yerine metin gösterilir.
      <span className="text-small text-ink-muted tabular-nums">İlerleme: %{Math.round(progress)}</span>
    ) : null,
    ai ? (
      <span className="text-small inline-flex items-center gap-2 text-ink-muted">
        <span aria-hidden="true" className="size-2 rounded-full bg-ai-glow ring-[3px] ring-ai-soft" />
        Öğrenmen sana göre hazırladı
      </span>
    ) : null,
  );
}
