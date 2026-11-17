import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';

export interface CoverProps extends ComponentPropsWithRef<'div'> {
  title?: string;
  tagline?: string;
}

/** Kapak bandı: sol altta kelime markası, sağda kod üretimi blok illüstrasyon (tema değişkenleriyle). */
export function Cover({ title = 'Öğrenmen', tagline = 'Kendi hızında, yanında bir öğretmenle.', className, ...rest }: CoverProps) {
  const chevrons = [146, 170, 194, 218, 242];
  return (
    <div {...rest} className={cn('relative h-72 w-full max-w-240 overflow-hidden bg-surface', className)}>
      <svg
        aria-hidden="true"
        viewBox="0 0 480 288"
        className="absolute top-0 right-0 hidden h-72 w-120 sm:block"
        preserveAspectRatio="xMaxYMid slice"
      >
        <rect x="24" y="-8" width="184" height="272" rx="4" className="fill-primary" />
        <rect x="224" y="-8" width="120" height="80" rx="4" className="fill-gold" />
        <rect x="224" y="88" width="272" height="176" rx="4" className="fill-ink" />
        <rect x="360" y="40" width="96" height="72" rx="4" className="fill-easy-purple" />
        {chevrons.map((y) => (
          <polyline
            key={y}
            points={`56,${y} 116,${y - 26} 176,${y}`}
            className="stroke-on-primary"
            fill="none"
            strokeWidth={8}
            strokeLinejoin="miter"
            strokeLinecap="butt"
          />
        ))}
      </svg>
      <div className="absolute bottom-6 left-6 max-w-110">
        <h1 className="m-0 text-[84px] leading-[0.95] font-bold tracking-[-0.02em] text-ink max-sm:text-[56px]">{title}</h1>
        <p className="text-small mt-2 ml-1 text-ink-muted">{tagline}</p>
      </div>
    </div>
  );
}
