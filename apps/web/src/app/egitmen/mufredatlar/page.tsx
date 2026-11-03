import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: "Müfredatlar" };

export default function Sayfa() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Müfredatlar" description="Kazanım ağaçlarını düzenle, yapay zekânın önerilerini incele." />
      <EmptyState title="Henüz müfredat yok">
        {"Müfredat ağacı editörü burada açılacak: kazanımları sürükleyerek düzenler, yapay zekânın önerdiği alt kazanımları kanıtıyla birlikte kabul eder ya da reddedersin."}
      </EmptyState>
    </div>
  );
}
