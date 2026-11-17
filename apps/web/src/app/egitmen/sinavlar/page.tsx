import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: "Sınavlar" };

export default function Sayfa() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Sınavlar" description="Cevap anahtarları ve atamalar." />
      <EmptyState title="Henüz sınav yok">
        {"Yüklenen ve üretilen sınavlar burada listelenir. Cevap anahtarını kontrol eder, öğrencilere atama yaparsın."}
      </EmptyState>
    </div>
  );
}
