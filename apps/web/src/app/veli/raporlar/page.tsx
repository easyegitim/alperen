import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: "Raporlar" };

export default function Sayfa() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Raporlar" description="Haftalık, deneme ve konu raporları." />
      <EmptyState title="Henüz rapor yok">
        {"Haftalık özet, deneme sonucu ve konu raporları hazırlandığında burada listelenir. İstediğin bir raporu buradan isteyebileceksin."}
      </EmptyState>
    </div>
  );
}
