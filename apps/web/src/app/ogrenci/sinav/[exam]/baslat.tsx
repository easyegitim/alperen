'use client';

import { useFormStatus } from 'react-dom';
import { buttonClasses } from '@/ds';
import { startExamAction } from '@/server/exam/actions';

function Dugme({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending || undefined} className={`${buttonClasses({ variant: 'primary', size: 'lg', block: true })} disabled:cursor-progress disabled:opacity-70`}>
      {label}
    </button>
  );
}

/** Tek birincil düğme: sunucu eylemi formu (JS'siz de çalışır); gönderim sürerken kilitlenir. */
export function Baslat({ examId, label, suggestionId }: { examId: string; label: string; suggestionId?: string }) {
  return (
    <form action={startExamAction}>
      <input type="hidden" name="exam" value={examId} />
      {suggestionId ? <input type="hidden" name="suggestion" value={suggestionId} /> : null}
      <Dugme label={label} />
    </form>
  );
}
