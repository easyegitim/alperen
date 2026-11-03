import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: "Soru tarzları" };

export default function Sayfa() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Soru tarzları" description="Çıkmış sorulardan çıkarılan tarz kütüphanesi." />
      <EmptyState title="Henüz soru tarzı yok">
        {"Çıkmış sınavları yüklediğinde sorular tarzlara ayrılır. Tarz kütüphanesi ve \"sıklık analizine göre öncelikler\" burada düzenlenebilir olarak görünür."}
      </EmptyState>
    </div>
  );
}
