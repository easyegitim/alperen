import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: "Sohbet" };

export default function Sayfa() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Sohbet" description="Çocuğunla ilgili sorularını istediğin saatte sor." />
      <EmptyState title="Sohbet henüz açık değil">
        {"Çocuğunun durumunu, bu hafta ne çalıştığını ve nelere dikkat etmen gerektiğini sormak için burayı kullanacaksın. Yanıtlar öğrencinin kendi sohbetlerinden değil, onun için hazırlanan özet ve raporlardan gelir."}
      </EmptyState>
    </div>
  );
}
