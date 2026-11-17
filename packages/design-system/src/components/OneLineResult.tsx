'use client';

import { useId, useState } from 'react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn, FOCUS_RING } from '../lib/cn';

export interface OneLineResultProps extends ComponentPropsWithRef<'section'> {
  /** Tek cümle sonuç: "8 soruda 6 doğru. Takıldığın yer: eksi dağıtırken işaret." */
  sentence: ReactNode;
  /** "Neyi öğrendik" tek satır. */
  learned?: string;
  /** Verilirse Detay düğmesi bu işlevi çağırır (ör. sayfa/ekran açar). */
  onDetail?: () => void;
  /** Verilirse Detay düğmesi bu içeriği aynı yerde açıp kapatır (ör. katlanır StepLadder). */
  children?: ReactNode;
  detailLabel?: string;
}

/** Test ya da teşhis sonucu: önce tek cümle ve tek satır "neyi öğrendik"; ayrıntı tek "Detay" arkasında. */
export function OneLineResult({
  sentence,
  learned,
  onDetail,
  children,
  detailLabel = 'Detay',
  className,
  ...rest
}: OneLineResultProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const hasInline = children != null && children !== false;
  const showButton = hasInline || Boolean(onDetail);
  return (
    <section aria-label="Sonuç" {...rest} className={cn('flex w-full flex-col gap-3', className)}>
      <p className="text-title-2 m-0 text-ink">{sentence}</p>
      {learned ? (
        <p className="text-body m-0 text-ink-muted">
          <span className="font-semibold text-ink">Neyi öğrendik: </span>
          {learned}
        </p>
      ) : null}
      {showButton ? (
        <button
          type="button"
          {...(hasInline ? { 'aria-expanded': open, 'aria-controls': id } : {})}
          onClick={() => {
            if (hasInline) setOpen((v) => !v);
            onDetail?.();
          }}
          className={cn(
            'text-label inline-flex min-h-11 cursor-pointer items-center self-start rounded-md bg-transparent px-2 text-primary hover:bg-primary-soft',
            FOCUS_RING,
          )}
        >
          {detailLabel}
        </button>
      ) : null}
      {hasInline ? (
        <div id={id} hidden={!open}>
          {children}
        </div>
      ) : null}
    </section>
  );
}
