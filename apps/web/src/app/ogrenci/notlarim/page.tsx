import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export const metadata: Metadata = { title: "Notlarım" };

export default function Sayfa() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Notlarım" description="Öğretmenin sana özel hazırladığı notlar." />
      <EmptyState title="Henüz notun yok">
        {"Bir konuda not istediğinde öğretmen seni tanıyarak sana özel bir not hazırlar. Notlar burada durum kartlarıyla görünür; istediğini PDF olarak indirir ya da \"Çöz\" ile sorulara geçersin."}
      </EmptyState>
    </div>
  );
}
