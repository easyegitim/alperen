import type { Metadata } from 'next';
import { CoachChat } from '@/components/chat/CoachChat';
import type { ChatBootstrap } from '@/lib/chat';
import { requireRole } from '@/server/auth';
import { loadBootstrap } from '@/server/chat/bootstrap';
import { saveCoachMode } from './actions';

export const metadata: Metadata = { title: 'Koç' };

// Koç (PLAN-v2 §13, mockup S03): klasik sohbet. Son koç sohbeti yüklenir; "Koça sor" derin bağlantısı
// (?seed=<solution_analysis_id>) teşhis bağlamını ilk mesaja ekler.
export default async function KocSayfasi({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole('student', 'admin');
  const params = await searchParams;
  const seed = typeof params.seed === 'string' ? params.seed : null;
  const initial: ChatBootstrap = await loadBootstrap(seed);
  return <CoachChat initial={initial} saveMode={saveCoachMode} />;
}
