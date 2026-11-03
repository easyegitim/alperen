import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/ds';
import { formatDateTimeTr } from '@/lib/format';
import { requireRole } from '@/server/auth';
import { listNotifications } from '@/server/queries';

export const metadata: Metadata = { title: 'Bildirimler' };

export default async function VeliBildirimler() {
  const { user } = await requireRole('parent', 'admin');
  const items = await listNotifications(user.id);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Bildirimler" description="Deneme sonuçları, haftalık özet ve önemli gelişmeler." />
      {items.length === 0 ? (
        <EmptyState title="Henüz bildirim yok">
          {'Bir deneme analiz edildiğinde, haftalık özet hazır olduğunda ya da çocuğunda belirgin bir ilerleme olduğunda burada görürsün. Anlık bildirimleri Ayarlar sayfasından açabilirsin.'}
        </EmptyState>
      ) : (
        <ul aria-label="Bildirimler" className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((n) => (
            <li key={n.id} className="flex flex-col gap-1 rounded-lg border border-line bg-surface-raised p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-label text-ink">{n.title}</span>
                {n.read_at ? null : <Badge tone="primary">Yeni</Badge>}
              </div>
              {n.body ? <p className="text-small m-0 text-ink-muted">{n.body}</p> : null}
              <span className="text-caption text-ink-muted">{formatDateTimeTr(n.created_at)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
