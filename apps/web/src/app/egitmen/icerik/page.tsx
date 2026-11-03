import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: "İçerik" };

export default function Sayfa() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <PageHeader title="İçerik" description="Üretilen not ve denemelerin incelemesi." />
      <EmptyState title="İncelenecek içerik yok">
        {"Yapay zekânın hazırladığı notlar ve denemeler yayımlanmadan önce burada incelenir. Şekiller ve çözümler doğrulanmadan öğrenciye gösterilmez."}
      </EmptyState>
    </div>
  );
}
