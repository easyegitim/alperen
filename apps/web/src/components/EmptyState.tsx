import Image from 'next/image';
import type { ReactNode } from 'react';
import mascot from '@ogrenmen/design-system/assets/Maskot/ogrenmen-maskot.webp';

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}

/** Boş durum: maskot (dekoratif), başlık, açıklama ve isteğe bağlı eylem. Maskotun üstüne metin yazılmaz. */
export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <section className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 rounded-lg border border-line bg-surface-raised p-6 text-center md:p-8">
      <Image src={mascot} alt="" width={102} height={128} sizes="102px" className="h-32 w-auto" />
      <h2 className="text-title-3 m-0 text-ink">{title}</h2>
      {children ? <div className="text-body m-0 max-w-prose text-ink-muted">{children}</div> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-3">{action}</div> : null}
    </section>
  );
}
