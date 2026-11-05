import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: "Kuyruk" };

export default function Sayfa() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="Kuyruk" description="İnceleme bekleyen işler." />
      <EmptyState title="Kuyruk boş">
        {"Ders iddiaları, müfredat önerileri ve düşük güvenli çıkarımlar eğitmen onayı beklerken burada sıralanır."}
      </EmptyState>
    </div>
  );
}
