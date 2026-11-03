import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';
import { Badge, type BadgeTone } from './Badge';

export type FigureStatus = 'verified' | 'pending' | 'failed';

const STATUS: Record<FigureStatus, { tone: BadgeTone; text: string }> = {
  verified: { tone: 'success', text: '✓ Şekil denetlendi' },
  pending: { tone: 'warning', text: 'Onay bekliyor' },
  failed: { tone: 'danger', text: '✕ Denetimden geçmedi' },
};

export interface FigureFrameProps extends Omit<ComponentPropsWithRef<'figure'>, 'children'> {
  src: string;
  /** Zorunlu: şekli kelimelerle anlatır. */
  alt: string;
  caption?: string;
  /** Üretim aracı; yalnızca öğretmen görünümünde. */
  source?: string;
  /** Verilmezse durum rozeti gösterilmez (öğrenci görünümü yalnızca verified şekil alır). */
  status?: FigureStatus;
  imgWidth?: number;
  imgHeight?: number;
}

/** Koddan üretilmiş soru şekli; her iki temada paper zemininde durur (şekil tema değişkeni kullanmaz). */
export function FigureFrame({ src, alt, caption, source, status, imgWidth, imgHeight, className, ...rest }: FigureFrameProps) {
  return (
    <figure {...rest} className={cn('m-0 box-border inline-flex max-w-full flex-col items-start gap-2', className)}>
      <img
        src={src}
        alt={alt}
        width={imgWidth}
        height={imgHeight}
        className="box-border block h-auto max-w-full rounded-md border border-line bg-paper p-3"
      />
      {caption || source || status ? (
        <figcaption className="text-small flex flex-wrap items-center gap-2 text-ink-muted">
          {caption ? <span className="text-ink">{caption}</span> : null}
          {source ? <span>{source}</span> : null}
          {status ? <Badge tone={STATUS[status].tone}>{STATUS[status].text}</Badge> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
