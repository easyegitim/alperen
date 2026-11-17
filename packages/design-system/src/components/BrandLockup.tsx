import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';

export type BrandLockupSize = 'sm' | 'md' | 'lg';

const MARK: Record<BrandLockupSize, string> = { sm: 'h-6', md: 'h-9', lg: 'h-14' };
const NAME: Record<BrandLockupSize, string> = { sm: 'text-[18px]', md: 'text-[26px]', lg: 'text-[40px]' };

export interface BrandLockupProps extends ComponentPropsWithRef<'span'> {
  /** Açık zeminde easy-isaret-mor.png, koyu zeminde ve dolgu üzerinde easy-isaret-beyaz.png adresi. */
  markSrc?: string;
  size?: BrandLockupSize;
  /** false: "by easy" satırını gizler (dar üst çubuk). */
  endorsement?: boolean;
}

/** easy işareti + "Öğrenmen" kelime markası. */
export function BrandLockup({ markSrc, size = 'md', endorsement = true, className, ...rest }: BrandLockupProps) {
  return (
    <span {...rest} className={cn('inline-flex items-center gap-2 text-ink', className)}>
      {markSrc ? <img src={markSrc} alt="" className={cn('block w-auto', MARK[size])} /> : null}
      <span className="inline-flex flex-col leading-none">
        <span className={cn('font-bold tracking-[-0.02em]', NAME[size])}>Öğrenmen</span>
        {endorsement ? (
          <span className={cn('text-caption mt-0.5 text-ink-muted', size === 'lg' && 'text-small')}>by easy</span>
        ) : null}
      </span>
    </span>
  );
}
