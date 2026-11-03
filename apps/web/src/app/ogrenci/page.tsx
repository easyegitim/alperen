import type { Metadata } from 'next';
import { Flame, Target } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { ModeToggle, TutorMessage } from '@/ds';
import { firstName } from '@/lib/format';
import { requireRole } from '@/server/auth';

export const metadata: Metadata = { title: 'Koç' };

export default async function KocSayfasi() {
  const { displayName } = await requireRole('student', 'admin');
  const name = firstName(displayName);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader title={name ? `Merhaba, ${name}` : 'Merhaba'} description="Koç burada: bugün ne yapacağını birlikte seçeriz." />

      <section aria-labelledby="gunun-plani" className="flex flex-col gap-3">
        <h2 id="gunun-plani" className="text-title-2 m-0 text-ink">
          Günün planı
        </h2>
        <EmptyState title="Günün planı henüz hazır değil">
          {'Bir ders seçtiğinde öğretmenin seni tanımaya başlar ve her gün için üç adımlık bir plan çıkarır. Plan burada kartlar halinde görünecek.'}
        </EmptyState>
        <ul className="text-small m-0 flex list-none flex-wrap gap-4 p-0 text-ink-muted">
          <li className="inline-flex items-center gap-2">
            <Flame aria-hidden="true" size={18} />
            Seri: henüz başlamadı
          </li>
          <li className="inline-flex items-center gap-2">
            <Target aria-hidden="true" size={18} />
            Haftalık hedef: belirlenmedi
          </li>
        </ul>
      </section>

      <section aria-labelledby="ogretmenle" className="flex flex-col gap-3">
        <h2 id="ogretmenle" className="text-title-2 m-0 text-ink">
          Öğretmenle konuş
        </h2>
        <TutorMessage from="tutor" name="Öğrenmen">
          {'Merhaba. Ben senin AI öğretmeninim. Takıldığın bir soruyu fotoğrafla ya da buraya yaz; önce ipucu veririm, çözümü görmek istersen sen seçersin.'}
        </TutorMessage>
        <ModeToggle defaultValue="hint" label="Öğretmen nasıl yardım etsin?" />
      </section>
    </div>
  );
}
