import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { ScreenHeader } from '@/components/shell';
import { Badge } from '@/ds';
import { firstName } from '@/lib/format';
import { requireRole } from '@/server/auth';
import { listChildren } from '@/server/queries';

export const metadata: Metadata = { title: 'Özet' };

// Veli Özet (mockup S10) iskeleti: çocuğun adı, tek cümle durum, "Soru sor" (tek birincil) ve "Rapor iste".
// Tek cümle durum, üç sayı ve son rapor P6'da (veli ajanı ve haftalık özet) bağlanır; şimdilik "Henüz veri yok."
export default async function VeliOzet() {
  const { user, displayName } = await requireRole('parent', 'admin');
  const children = await listChildren(user.id);
  const only = children.length === 1 ? children[0] : null;
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
