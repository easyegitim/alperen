import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Avatar, Badge } from '@/ds';
import { GRADE_LABELS, GRADES } from '@/lib/validation';
import { requireRole } from '@/server/auth';
import { listChildren } from '@/server/queries';

export const metadata: Metadata = { title: 'Özet' };

export default async function VeliOzet() {
  const { user, displayName } = await requireRole('parent', 'admin');
  const children = await listChildren(user.id);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title={displayName ? `Merhaba, ${displayName.split(' ')[0]}` : 'Özet'} description="Çocuğunun durumu tek bakışta." />
      {children.length === 0 ? (
        <EmptyState title="Henüz bağlı bir çocuk yok">
          {'Çocuğunla bağlantı kurmak için öğrencinin gönderdiği davet kodunu Ayarlar sayfasından girebilirsin.'}
        </EmptyState>
      ) : (
        <ul aria-label="Çocukların" className="m-0 flex list-none flex-col gap-4 p-0">
          {children.map((c) => (
            <li key={c.id} className="flex flex-col gap-4 rounded-lg border border-line bg-surface-raised p-4">
              <div className="flex items-center gap-3">
                <Avatar name={c.name} variant="photo" size="lg" />
                <div className="flex min-w-0 flex-col">
                  <span className="text-title-3 truncate text-ink">{c.name}</span>
                  <span className="text-small text-ink-muted">{c.grade && (GRADES as readonly string[]).includes(c.grade) ? GRADE_LABELS[c.grade as (typeof GRADES)[number]] : 'Sınıf belirtilmedi'}</span>
                </div>
                <Badge tone="neutral" className="ml-auto">
                  Bağlı
                </Badge>
              </div>
              <p className="text-small m-0 text-ink-muted">Haftalık özet ve durum kartları ilk veriler geldiğinde burada görünür.</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
