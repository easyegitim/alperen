import Link from 'next/link';
import { X } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import type { ViewableDocument } from '@/server/documents/read';
import { DocumentViewer } from './DocumentViewer';

/**
 * Belge ekranı (S09): Kapat + görüntüleyici; PDF hazır değilse boş durum. Öğrenci (/ogrenci/belge/[id]) ve veli
 * (/veli/rapor/[id]) aynı ekranı kullanır; fark yalnız kapanış adresi.
 */
export function DocumentScreen({ doc, closeHref, backLabel }: { doc: ViewableDocument; closeHref: string; backLabel: string }) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div className="flex h-15 items-center">
        <Link href={closeHref} aria-label="Kapat" className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken hover:text-ink">
          <X aria-hidden="true" size={24} strokeWidth={1.75} />
        </Link>
      </div>
      {doc.src ? (
        <DocumentViewer src={doc.src} title={doc.title} />
      ) : (
        <>
          <h1 className="sr-only">{doc.title}</h1>
          <EmptyState title="Bu belge henüz hazır değil" action={<LinkButton href={closeHref}>{backLabel}</LinkButton>}>
            {'PDF hazır olunca burada sayfa sayfa açılır.'}
          </EmptyState>
        </>
      )}
    </div>
  );
}
