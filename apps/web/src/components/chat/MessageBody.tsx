'use client';

import { MathText } from '@/ds';

/** Balon metni: boş satırla ayrılan paragraflar, satır içi ve ayrı satır KaTeX (`$…$`, `$$…$$`). */
export function MessageBody({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-2 break-words">
      {paragraphs.map((p, i) => (
        <p key={i} className="m-0 whitespace-pre-line">
          <MathText>{p}</MathText>
        </p>
      ))}
    </div>
  );
}
