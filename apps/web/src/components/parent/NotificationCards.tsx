import Link from 'next/link';
import { Button } from '@/ds';
import { formatDateTimeTr } from '@/lib/format';
import type { NotificationCard } from '@/lib/parent';
import { markNotificationRead } from '@/app/veli/actions';

/**
 * Özet'te tek ince kart (mockup S10 sadeliği): yalnız en yeni okunmamış bildirim ve tek "Okudum". Okununca sıradaki gelir.
 * Bağlantısı olan bildirimde başlık bağlantıdır (rapor, deneme sonucu); ayrı bir düğme yoktur. Boşsa hiçbir şey çizilmez.
 */
export function NotificationCards({ items }: { items: readonly NotificationCard[] }) {
  const n = items[0];
  if (!n) return null;
  const link = n.href && n.href !== '/veli' ? n.href : null;
  return (
    <section aria-label="Bildirim" data-testid="bildirim" className="flex flex-col gap-2 rounded-lg border border-line bg-surface-raised p-4">
      <div className="flex flex-col gap-1">
        {link ? (
          <Link href={link} className="text-label text-ink">
            {n.title}
          </Link>
        ) : (
          <span className="text-label text-ink">{n.title}</span>
        )}
        {n.body ? <p className="text-small m-0 text-ink-muted">{n.body}</p> : null}
        <span className="text-caption text-ink-muted">{formatDateTimeTr(n.createdAt)}</span>
      </div>
      <form action={markNotificationRead} className="m-0">
        <input type="hidden" name="id" value={n.id} />
        <Button type="submit" variant="quiet" size="sm">
          Okudum
        </Button>
      </form>
    </section>
  );
}
