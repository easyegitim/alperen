'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useLive } from '@/lib/live';
import { documentLine } from '@/server/progress/present';
import { documentHref, type LibraryRow } from '@/server/documents/present';

/** Hazırlanan belge varken sayfa bu aralıkla tazelenir (en çok 10 dk). */
const WATCH_MS = 10 * 60_000;

const WORD_CLASS: Record<LibraryRow['word'], string> = {
  Hazır: 'bg-success-soft text-success',
  İncelemede: 'bg-warning-soft text-warning',
  Hazırlanıyor: 'bg-surface-sunken text-ink-muted',
};

/**
 * Belgelerim satırları: başlık + durum kelimesi (Hazırlanıyor · İncelemede · Hazır). Hazır olan satır belge
 * görüntüleyiciyi açar; hazırlananlar varken liste kendiliğinden tazelenir (Realtime document_requests ya da yoklama).
 */
export function LibraryList({ rows }: { rows: LibraryRow[] }) {
  const router = useRouter();
  const pending = rows.some((r) => !r.open);
  useLive({
    key: `library-${rows.filter((r) => !r.open).map((r) => r.id).join(',')}`,
    enabled: pending,
    tables: [{ table: 'document_requests', event: 'UPDATE' }],
    timing: { maxElapsedMs: WATCH_MS, minMs: 4_000, maxMs: 8_000 },
    check: () => {
      router.refresh();
      return false;
    },
  });
  return (
    <ul className="m-0 flex list-none flex-col p-0" data-testid="belge-listesi">
      {rows.map((r) => {
        const body = (
          <>
            <span className="text-label min-w-0 flex-1 font-normal">{documentLine(r.title, r.kind)}</span>
            <span className={cn('text-small box-border shrink-0 rounded-full px-3 py-0.5 text-center font-medium', WORD_CLASS[r.word])}>{r.word}</span>
          </>
        );
        return (
          <li key={r.id} className="flex border-t border-line">
            {r.open ? (
              <Link href={documentHref(r.id)} className="flex min-h-13 flex-1 items-center justify-between gap-3 rounded-md text-ink no-underline">
                {body}
                <ChevronRight aria-hidden="true" size={20} className="shrink-0 text-ink-muted" />
              </Link>
            ) : (
              <div className="flex min-h-13 flex-1 items-center justify-between gap-3 text-ink">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
