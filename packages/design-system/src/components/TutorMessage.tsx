import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { Avatar } from './Avatar';
import { Button } from './Button';

/** Eğitmen denetim satırı: her bot cevabı model, maliyet ve kullandığı hafıza olgusu sayısıyla kaydedilir. */
export interface TutorReview {
  model?: string;
  /** Biçimlenmiş maliyet ("0,002 $"). Yalnızca eğitmen görünümünde. */
  cost?: string;
  memory?: number;
  flagged?: boolean;
  onFlag?: () => void;
}

export interface TutorMessageProps extends Omit<ComponentPropsWithRef<'article'>, 'children'> {
  from?: 'tutor' | 'student';
  /** Ad satırı; öğretmen için varsayılan "Öğrenmen". */
  name?: string;
  /** Maskot görselinin adresi; bileşen yüze kırpar. */
  avatarSrc?: string;
  /** Yanıt beklenirken yazıyor noktaları. */
  typing?: boolean;
  /** En fazla iki Button (secondary + quiet). */
  actions?: ReactNode;
  /** Yalnızca eğitmen görünümü. */
  review?: TutorReview;
  children?: ReactNode;
}

/** Yapay zekâ öğretmen ile öğrenci arasındaki sohbet balonu. Öğretmen her zaman "AI öğretmen" etiketini taşır. */
export function TutorMessage({
  from = 'tutor',
  name,
  avatarSrc,
  typing,
  actions,
  review,
  className,
  children,
  ...rest
}: TutorMessageProps) {
  const tutor = from === 'tutor';
  return (
    <article
      {...rest}
      className={cn('flex max-w-140 items-start gap-3', !tutor && 'ml-auto justify-end', className)}
    >
      {tutor ? <Avatar variant="mascot" src={avatarSrc} name={name ?? 'Öğrenmen'} ai /> : null}
      <div className={cn('flex min-w-0 flex-col gap-1', !tutor && 'items-end')}>
        {tutor || name ? (
          <span className="text-small inline-flex items-center gap-2 font-semibold text-ink">
            {name ?? (tutor ? 'Öğrenmen' : '')}
            {tutor ? <span className="text-caption text-ink-muted">AI öğretmen</span> : null}
          </span>
        ) : null}
        <div
          className={cn(
            'rounded-lg px-4 py-3 text-body',
            tutor ? 'rounded-tl-sm bg-ai-soft text-ink shadow-ai' : 'rounded-tr-sm bg-primary text-on-primary',
          )}
        >
          {tutor ? (
            // Canlı bölge baştan DOM'da durur; yalnız içindeki metin değişir (ekran okuyucular böyle duyurur).
            <span role="status" className="sr-only">
              {typing ? 'Öğretmen yazıyor' : ''}
            </span>
          ) : null}
          {typing ? (
            <span aria-hidden="true" className="inline-flex h-6 items-center gap-1">
              <span className="og-typing-dot size-2 rounded-full bg-primary opacity-35" />
              <span className="og-typing-dot size-2 rounded-full bg-primary opacity-35" />
              <span className="og-typing-dot size-2 rounded-full bg-primary opacity-35" />
            </span>
          ) : (
            children
          )}
        </div>
        {actions ? <div className="mt-1 flex flex-wrap gap-2">{actions}</div> : null}
        {review ? (
          <div className="text-caption mt-1 flex flex-wrap items-center gap-2 text-ink-muted">
            {review.model ? <span>Model: {review.model}</span> : null}
            {review.cost ? <span>· Maliyet: {review.cost}</span> : null}
            {typeof review.memory === 'number' ? <span>· Hafıza olgusu: {review.memory}</span> : null}
            {review.flagged ? (
              <span className="font-medium text-danger">✕ İşaretlendi</span>
            ) : review.onFlag ? (
              <Button variant="quiet" size="sm" onClick={review.onFlag}>
                İşaretle
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
