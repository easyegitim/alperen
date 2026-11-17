import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, Notice } from '@/ds';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { countByKind, groupQueue, parseQueue, QUEUE_KIND_LABELS, QUEUE_KINDS, QUEUE_MESSAGES, type QueueItem } from '@/lib/queue';
import { requireRole } from '@/server/auth';
import { studentDb } from '@/server/practice/client';
import { callRpc, isMissingFunction } from '@/server/practice/rpc';
import { approveSpendCapped, resolveNote } from './actions';

export const metadata: Metadata = { title: 'Kuyruk' };

// Kullanıcının JWT'siyle instructor_queue (0050; yalnız eğitmen/admin, eğitmende bağlı öğrenciler ve kendi dersleri).
// RPC yoksa (göç uygulanmamış, E2E sahte Supabase) boş; diğer hatalar loglanır ve kullanıcıya söylenir.
async function loadQueue(): Promise<{ items: QueueItem[]; failed: boolean }> {
  const res = await callRpc(await studentDb(), 'instructor_queue', {}, parseQueue);
  if (res.ok) return { items: res.data, failed: false };
  if (isMissingFunction(res.error)) return { items: [], failed: false };
  console.error('[kuyruk] instructor_queue', res.code, res.error.message);
  return { items: [], failed: true };
}

const TIME_FMT = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : TIME_FMT.format(d);
};

function Action({ item }: { item: QueueItem }) {
  if (item.kind === 'coach_note') {
    return (
      <form action={resolveNote}>
        <input type="hidden" name="id" value={item.id} />
        <Button type="submit" variant="secondary" size="sm">
          Okundu
        </Button>
      </form>
    );
  }
  if (item.kind === 'spend_cap') {
    return (
      <form action={approveSpendCapped}>
        <input type="hidden" name="id" value={item.id} />
        <Button type="submit" variant="primary" size="sm">
          Onayla ve üret
        </Button>
      </form>
    );
  }
  return item.href ? (
    <Link href={item.href} className="text-small text-primary">
      İncele
    </Link>
  ) : null;
}

export default async function Sayfa({ searchParams }: { searchParams: Promise<{ durum?: string | string[] }> }) {
  await requireRole('instructor', 'admin');
  const sp = await searchParams;
  const status = typeof sp.durum === 'string' ? sp.durum : null;
  const message = status ? (QUEUE_MESSAGES[status] ?? null) : null;
  const { items, failed } = await loadQueue();
  const counts = countByKind(items);
  const groups = groupQueue(items);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Kuyruk" description="Eğitmen kararı bekleyen işler, en yeni önce." />
      {message ? <Notice tone={status === 'okundu' || status === 'onaylandi' || status === 'zaten' ? 'info' : 'warning'}>{message}</Notice> : null}
      {failed ? (
        <p role="alert" className="text-small text-danger">
          Kuyruk şu an yüklenemedi. Biraz sonra yeniden dene.
        </p>
      ) : null}
      <ul className="text-small m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-ink-muted" aria-label="Türe göre sayılar">
        {QUEUE_KINDS.map((k) => (
          <li key={k}>
            {QUEUE_KIND_LABELS[k]}: <span className="tabular-nums text-ink">{counts[k]}</span>
          </li>
        ))}
      </ul>
      {groups.length === 0 && !failed ? (
        <EmptyState title="Kuyruk boş">
          {'Koç notları, harcama tavanında duran üretimler, incelemedeki belgeler, düşük güvenli ders iddiaları ve müfredat önerileri eğitmen kararı beklerken burada sıralanır.'}
        </EmptyState>
      ) : null}
      {groups.map((g) => (
        <section key={g.kind} className="flex flex-col gap-2" aria-labelledby={`kuyruk-${g.kind}`}>
          <h2 id={`kuyruk-${g.kind}`} className="text-label text-ink">
            {g.label} <span className="tabular-nums text-ink-muted">({g.items.length})</span>
          </h2>
          <ul className="m-0 flex list-none flex-col rounded-lg border border-line p-0">
            {g.items.map((i) => (
              <li key={`${i.kind}:${i.id}`} className="text-small flex items-start justify-between gap-3 border-b border-line px-3 py-2 last:border-b-0">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-medium text-ink">{i.title}</span>
                  {i.detail ? <span className="whitespace-pre-line text-ink-muted">{i.detail}</span> : null}
                  <span className="text-ink-muted">
                    {[i.studentName, when(i.createdAt)].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <div className="shrink-0">
                  <Action item={i} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
