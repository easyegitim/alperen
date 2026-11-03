import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: "Denemeler" };

export default function Sayfa() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Denemeler" description="Deneme çözümlerini ve sonuçlarını buradan takip edeceksin." />
      <EmptyState title="Henüz deneme yok">
        {"Bir denemeyi fotoğrafla yüklediğinde ya da uygulamada çözdüğünde netlerin, bölüm sonuçların ve kazanım ısı haritan burada görünür. Her yanlış için nereye kadar geldiğini birlikte buluruz."}
      </EmptyState>
    </div>
  );
}
