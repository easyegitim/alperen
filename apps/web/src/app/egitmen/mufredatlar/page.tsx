import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/ds';
import { DRAFT_STATUS_LABELS, STATUS_LABELS, type DraftStatus } from '@/lib/curriculum-tree';
import { requireRole } from '@/server/auth';
import { listCurricula } from '@/server/curricula';

export const metadata: Metadata = { title: 'Müfredatlar' };

const STATUS_TONE = { draft: 'warning', active: 'success', retired: 'neutral' } as const;
const ORIGIN_LABELS: Record<string, string> = { seed: 'İçerik', ai_draft: 'Yapay zekâ taslağı', instructor: 'Eğitmen' };

export default async function Sayfa() {
  await requireRole('instructor', 'admin');
  const items = await listCurricula();
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Müfredatlar" description="Kazanım ağaçlarını düzenle, yapay zekânın önerilerini incele, taslağı yayınla." />
      {items.length === 0 ? (
        <EmptyState title="Henüz müfredat yok">
          {'Bir öğrenci yeni bir ders seçtiğinde Öğrenmen kazanım ağacını taslak olarak kurar; taslak burada görünür ve düzenleyip yayınlarsın.'}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface-raised">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Müfredatlar: ders, sürüm, durum ve açık öneri sayısı</caption>
            <thead>
              <tr className="text-small border-b border-line text-ink-muted">
                <th scope="col" className="px-4 py-3 font-medium">Ders</th>
                <th scope="col" className="px-4 py-3 font-medium">Sürüm</th>
                <th scope="col" className="px-4 py-3 font-medium">Durum</th>
                <th scope="col" className="px-4 py-3 font-medium">Öneri</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-b border-line last:border-b-0" data-testid={`curriculum-${c.id}`}>
                  <td className="px-4 py-3">
                    <Link href={`/egitmen/mufredatlar/${c.id}`} className="text-label text-primary">
                      {c.courses[0] ?? c.label}
                    </Link>
                    <div className="text-caption text-ink-muted">
                      <code className="font-mono">{c.code}</code> · {ORIGIN_LABELS[c.origin] ?? c.origin}
                    </div>
                  </td>
                  <td className="text-body px-4 py-3 tabular-nums text-ink">{c.version}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABELS[c.status]}</Badge>
                      {c.draft_status && c.draft_status !== 'ready' ? (
                        <span className={`text-caption ${c.draft_status === 'failed' ? 'text-danger' : 'text-ink-muted'}`}>
                          {DRAFT_STATUS_LABELS[c.draft_status as DraftStatus]}
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="text-body px-4 py-3 tabular-nums text-ink">{c.openProposals > 0 ? <Badge tone="ai">{c.openProposals} açık</Badge> : <span className="text-ink-muted">Yok</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
