import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { ScreenHeader } from '@/components/shell';
import { Badge } from '@/ds';
import { firstName } from '@/lib/format';
import { requireRole } from '@/server/auth';
import { guardianDocumentHref, latestReport } from '@/server/documents/present';
import { documentDb } from '@/server/documents/read';
import { documentLine } from '@/server/progress/present';
import { listMyDocuments } from '@/server/documents/rpc';
import { listChildren } from '@/server/queries';

export const metadata: Metadata = { title: 'Özet' };

// Veli Özet (mockup S10) iskeleti: çocuğun adı, tek cümle durum, "Soru sor" (tek birincil) ve "Rapor iste".
// Tek cümle durum, üç sayı ve son rapor P6'da (veli ajanı ve haftalık özet) bağlanır; şimdilik "Henüz veri yok."
export default async function VeliOzet() {
  const { user, displayName } = await requireRole('parent', 'admin');
  const children = await listChildren(user.id);
  const only = children.length === 1 ? children[0] : null;
  // Son rapor kartı (iskelet): çocuğun en yeni hazır raporu; aynı belge görüntüleyiciyi açar.
  const db = await documentDb();
  // veli için RPC çocukların raporlarını tek çağrıda döner; çocuğa göre ayrılır
  const all = await listMyDocuments(db, { kind: 'report', limit: 100 });
  const reports = new Map(children.map((c) => [c.id, all.ok ? latestReport(all.data, c.id) : null] as const));
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <ScreenHeader title={only ? firstName(only.name) || 'Özet' : 'Özet'} name={displayName} accountHref="/veli/ayarlar" size="sm" />
      {children.length === 0 ? (
        <EmptyState title="Henüz bağlı bir çocuk yok">
          {'Çocuğunla bağlantı kurmak için öğrencinin gönderdiği davet kodunu Ayarlar sayfasından girebilirsin.'}
        </EmptyState>
      ) : (
        <>
          <ul aria-label="Çocukların" className="m-0 flex list-none flex-col gap-4 p-0">
            {children.map((c) => (
              <li key={c.id} className="flex flex-col gap-3">
                <Badge tone="ai" className="self-start">
                  {c.name}
                </Badge>
                <p className="text-body-lg m-0 text-ink" data-testid="veli-durum">
                  Henüz veri yok.
                </p>
                {reports.get(c.id) ? (
                  <Link
                    href={guardianDocumentHref(reports.get(c.id)!.id)}
                    data-testid="son-rapor"
                    className="flex min-h-13 items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised px-5 py-3 text-ink no-underline"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-caption text-ink-muted">Son rapor</span>
                      <span className="text-label font-normal">{documentLine(reports.get(c.id)!.title, 'report')}</span>
                    </span>
                    <ChevronRight aria-hidden="true" size={20} className="shrink-0 text-ink-muted" />
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2">
            <LinkButton href="/veli/sohbet" variant="primary" size="lg" block>
              Soru sor
            </LinkButton>
            <LinkButton href="/veli/sohbet?istek=rapor" variant="quiet" size="lg" block>
              Rapor iste
            </LinkButton>
          </div>
        </>
      )}
    </div>
  );
}
