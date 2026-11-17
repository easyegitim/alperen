import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, FileText } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { formatDateTimeTr } from '@/lib/format';
import { requireRole } from '@/server/auth';
import { guardianDocumentHref, isViewable, reportKindWord } from '@/server/documents/present';
import { listMyDocuments } from '@/server/documents/rpc';
import { parentChildren, parentDb, pickChild } from '@/server/parent/children';

export const metadata: Metadata = { title: 'Raporlar' };

// Veli: çocuğun raporları, en yeni önce (en çok 30); her satır mevcut rapor görüntüleyicisine gider.
export default async function VeliRaporlar({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user } = await requireRole('parent', 'admin');
  const child = pickChild(await parentChildren(user.id), (await searchParams).cocuk);
  const res = child ? await listMyDocuments(await parentDb(), { kind: 'report', studentId: child.id, limit: 30 }) : null;
  const docs = res?.ok ? res.data.filter(isViewable) : [];
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <PageHeader title="Raporlar" description={child ? `${child.name} için hazırlanan raporlar.` : undefined} />
      {docs.length === 0 ? (
        <EmptyState title="Henüz rapor yok">Rapor hazırlandığında burada görünür.</EmptyState>
      ) : (
        <ul aria-label="Raporlar" className="m-0 flex list-none flex-col gap-2 p-0">
          {docs.map((d) => (
            <li key={d.id}>
              <Link href={guardianDocumentHref(d.id)} className="flex min-h-13 items-center gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3 text-ink no-underline">
                <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
                  <FileText size={20} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-label font-normal">{d.title}</span>
                  <span className="text-small text-ink-muted">
                    {formatDateTimeTr(d.created_at).split(' ').slice(0, 2).join(' ')} · {reportKindWord(d)}
                  </span>
                </span>
                <ChevronRight aria-hidden="true" size={20} className="shrink-0 text-ink-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
