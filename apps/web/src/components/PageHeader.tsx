import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  description?: string;
  /** Sağ üst eylem alanı (ör. düğme). */
  actions?: ReactNode;
}

/** Sayfa başlığı: her sayfada tek h1. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-title-1 m-0 text-ink">{title}</h1>
        {description ? <p className="text-body mt-1 mb-0 max-w-prose text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-3">{actions}</div> : null}
    </header>
  );
}
