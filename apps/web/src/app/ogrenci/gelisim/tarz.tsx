import { ChevronDown } from 'lucide-react';
import type { StudentStyleSummary } from '@/server/styles/read';
import { studentStyleLine } from '@/server/styles/shared';

/**
 * Gelişim › Konular altında tek satır (S08): "Tarz: 2/5 çözdün". Katlıdır; açılınca her tarzın adı ve kapsama cümlesi
 * ("Bu tarzı hiç çözmedin", "3 çözdün, 1 doğru"). Tarz yoksa hiç çizilmez; yüzde ve çıkmış soru metni yok.
 */
export function StyleCoverageLine({ summary }: { summary: StudentStyleSummary | null }) {
  const line = studentStyleLine(summary);
  if (!summary || !line) return null;
  return (
    <details className="group border-t border-line" data-testid="tarz-satiri">
      <summary className="text-label flex min-h-13 cursor-pointer list-none items-center justify-between gap-3 font-normal text-ink [&::-webkit-details-marker]:hidden">
        <span>{line}</span>
        <ChevronDown aria-hidden="true" size={18} className="shrink-0 text-ink-muted transition-transform group-open:rotate-180" />
      </summary>
      <ul className="m-0 flex list-none flex-col p-0 pb-2">
        {summary.rows.map((r) => (
          <li key={r.styleId} className="flex min-h-11 items-center justify-between gap-3 border-t border-line">
            <span className="text-small text-ink">{r.name}</span>
            <span className="text-small shrink-0 text-ink-muted">{r.text}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
