import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: "Maliyet" };

export default function Sayfa() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Maliyet" description="Yapay zekâ harcaması ve tavanlar." />
      <EmptyState title="Henüz harcama kaydı yok">
        {"Model çağrılarının maliyeti öğrenci, ders ve iş türüne göre burada görünür. Günlük ve aylık tavanları buradan izlersin."}
      </EmptyState>
    </div>
  );
}
