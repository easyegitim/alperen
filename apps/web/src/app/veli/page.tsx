import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, FileText, Settings } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { LinkButton } from '@/components/LinkButton';
import { NotificationCards } from '@/components/parent/NotificationCards';
import { ReportRequest } from '@/components/parent/ReportRequest';
import { Stat } from '@/components/parent/Stat';
import { ScreenHeader } from '@/components/shell';
import { Badge } from '@/ds';
import { PARENT_COPY, formatTr, summarySentence } from '@/lib/parent';
import { formatDateTimeTr } from '@/lib/format';
import { requireRole } from '@/server/auth';
import { guardianDocumentHref } from '@/server/documents/present';
import { parentChildren, parentDb, pickChild } from '@/server/parent/children';
import { loadNotifications, loadSummary } from '@/server/parent/rpc';

export const metadata: Metadata = { title: 'Özet' };

// Veli Özet (mockup S10): çocuğun adı, tek cümle durum, üç sayı (saat · soru · son deneme neti), son rapor kartı,
// "Soru sor" (tek birincil) ve sessiz "Rapor iste" (tür seçimi tek satır). En yeni okunmamış bildirim tek ince kart; dişli
// bildirim ayarlarına gider. Tek cümle sunucuda şablonla kurulur (parent_child_summary); ham olasılık ve yüzde yoktur.
export default async function VeliOzet({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { user, displayName } = await requireRole('parent', 'admin');
  const children = await parentChildren(user.id);
  const params = await searchParams;
  const child = pickChild(children, params.cocuk);
  const gear = (
    <Link
      href="/veli/bildirimler"
      aria-label="Bildirim ayarları"
      className="inline-flex size-10 items-center justify-center rounded-full text-ink-muted no-underline hover:bg-surface-sunken focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <Settings aria-hidden="true" size={20} />
    </Link>
  );

  if (!child) {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
        <ScreenHeader title="Özet" name={displayName} accountHref="/veli/ayarlar" size="sm" action={gear} />
        <EmptyState title={PARENT_COPY.noChild}>{PARENT_COPY.noChildBody}</EmptyState>
      </div>
    );
  }

  const db = await parentDb();
  const [summary, notes] = await Promise.all([loadSummary(db, child.id), loadNotifications(db, 1)]);
  const s = summary.ok ? summary.data : null;
  const sentence = s ? summarySentence({ ...s, name: child.name }) : PARENT_COPY.noData;
  const hours = s ? formatTr(s.hours || s.minutes / 60) : '0';
  const chat = `/veli/sohbet${children.length > 1 ? `?cocuk=${child.id}` : ''}`;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <ScreenHeader title={child.name} name={displayName} accountHref="/veli/ayarlar" size="sm" action={gear} />
      {children.length > 1 ? (
        <nav aria-label="Çocuklar" className="-mt-4 flex flex-wrap gap-2">
          {children.map((c) => (
            <Link
              key={c.id}
              href={`/veli?cocuk=${c.id}`}
              aria-current={c.id === child.id ? 'page' : undefined}
              className="text-small min-h-10 rounded-full border border-line px-4 py-2 text-ink no-underline aria-[current=page]:border-primary aria-[current=page]:bg-primary-soft aria-[current=page]:text-primary"
            >
              {c.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <section aria-labelledby="hafta-ozet" className="flex flex-col gap-3">
        <Badge tone="ai" className="self-start">
          Öğrenmen hazırladı
        </Badge>
        <p id="hafta-ozet" className="text-body-lg m-0 text-ink" data-testid="veli-durum">
          {sentence}
        </p>
      </section>

      {s ? (
        <dl aria-label="Bu hafta" className="m-0 grid grid-cols-3 gap-3">
          <Stat value={hours} unit="saat" label="çalıştı" />
          <Stat value={String(s.questions)} unit="soru" label="çözdü" />
          <Stat value={s.lastExam?.net != null ? formatTr(s.lastExam.net) : 'henüz yok'} unit="net" label="son deneme" />
        </dl>
      ) : null}

      {s?.latestReport ? (
        <Link
          href={guardianDocumentHref(s.latestReport.id)}
          data-testid="son-rapor"
          className="flex min-h-13 items-center gap-3 rounded-lg border border-line bg-surface-raised px-4 py-3 text-ink no-underline"
        >
          <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
            <FileText size={20} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-label font-normal">{s.latestReport.title}</span>
            <span className="text-small text-ink-muted">{formatDateTimeTr(s.latestReport.createdAt).split(' ').slice(0, 2).join(' ')} · PDF</span>
          </span>
          <ChevronRight aria-hidden="true" size={20} className="shrink-0 text-ink-muted" />
        </Link>
      ) : null}

      {notes.ok ? <NotificationCards items={notes.data.items} /> : null}

      <div className="flex flex-col gap-2">
        <LinkButton href={chat} variant="primary" size="lg" block>
          Soru sor
        </LinkButton>
        <ReportRequest studentId={child.id} />
      </div>
    </div>
  );
}
