import type { Metadata } from 'next';
import { PageHeader } from '@/components/PageHeader';
import { TutorMessage } from '@/ds';

export const metadata: Metadata = { title: 'Koç' };

// Koç: klasik sohbet (PLAN-v2 §13). Sohbet bağlanana dek karşılama mesajı gösterilir; İpucu/Açıkla/Çözümü göster
// seçicisi mesajın altına sohbet bağlandığında eklenir (şimdilik etkisiz bir kontrol çizilmez).
export default function KocSayfasi() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader title="Koç" />
      <TutorMessage from="tutor" name="Öğrenmen">
        {'Merhaba. Ben senin AI koçunum. Takıldığın bir soruyu fotoğrafla ya da buraya yaz; önce ipucu veririm, çözümü görmek istersen sen seçersin.'}
      </TutorMessage>
    </div>
  );
}
