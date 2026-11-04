'use client';

import dynamic from 'next/dynamic';
import type { ExamRunnerProps } from './ExamRunner';

// Oynatıcı ilk durumu istemci saatinden ve localStorage'tan okur; sunucuda render edilirse hidrasyon uyuşmaz (React #418).
// Bu yüzden yalnız istemcide yüklenir; o ana kadar iskelet görünür.
const ExamRunner = dynamic(() => import('./ExamRunner').then((m) => m.ExamRunner), {
  ssr: false,
  loading: () => (
    <div className="mx-auto flex min-h-[calc(100dvh-48px)] w-full max-w-xl items-center justify-center" aria-busy="true">
      <p className="text-body m-0 text-ink-muted">Deneme açılıyor…</p>
    </div>
  ),
});

export function ExamRunnerLoader(props: ExamRunnerProps) {
  return <ExamRunner {...props} />;
}
