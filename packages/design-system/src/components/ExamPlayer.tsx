import type { ComponentPropsWithRef, ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { cn } from '../lib/cn';
import { AnswerGrid, type AnswerGridItem } from './AnswerGrid';
import { Button } from './Button';
import { Timer } from './Timer';

export interface ExamPlayerProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'onSelect'> {
  title: string;
  /** Kalan süre (sn); verilmezse sayaç gösterilmez. */
  remainingSec?: number;
  questions: AnswerGridItem[];
  /** Şu anki soru numarası. */
  current: number;
  onNavigate: (no: number) => void;
  onToggleFlag?: (no: number) => void;
  onFinish?: () => void;
  /** Soru gövdesi (stem, FigureFrame, QuizOption listesi, karalama vb.). */
  children?: ReactNode;
}

/**
 * Sınav oynatıcı kabuğu: üstte başlık, Timer ve "Sınavı bitir"; ortada soru; altta önceki/sonraki ve bayrak;
 * yanda (mobilde altta) AnswerGrid. Soru içeriği ve cevap durumu uygulamadan gelir.
 */
export function ExamPlayer({
  title,
  remainingSec,
  questions,
  current,
  onNavigate,
  onToggleFlag,
  onFinish,
  children,
  className,
  ...rest
}: ExamPlayerProps) {
  const index = questions.findIndex((q) => q.no === current);
  const prev = index > 0 ? questions[index - 1] : undefined;
  const next = index >= 0 && index < questions.length - 1 ? questions[index + 1] : undefined;
  const flagged = questions[index]?.status === 'flagged';
  const answered = questions.filter((q) => q.status === 'answered').length;

  return (
    <div {...rest} className={cn('mx-auto flex w-full max-w-5xl flex-col gap-4', className)}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h1 className="text-title-3 m-0 text-ink">{title}</h1>
          <span className="text-small text-ink-muted">
            Soru {current} / {questions.length} · {answered} soru cevaplandı
          </span>
        </div>
        <div className="flex items-center gap-2">
          {typeof remainingSec === 'number' ? <Timer remainingSec={remainingSec} /> : null}
          {onFinish ? (
            <Button variant="secondary" onClick={onFinish}>
              Sınavı bitir
            </Button>
          ) : null}
        </div>
      </header>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
        <main className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface-raised p-4" aria-label={`Soru ${current}`}>
          {children}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
            <Button variant="quiet" icon={<ChevronLeft size={18} />} disabled={!prev} onClick={() => prev && onNavigate(prev.no)}>
              Önceki
            </Button>
            {onToggleFlag ? (
              <Button variant="secondary" icon={<Flag size={18} />} aria-pressed={flagged} onClick={() => onToggleFlag(current)}>
                {flagged ? 'Bayrağı kaldır' : 'Bayrakla'}
              </Button>
            ) : null}
            <Button variant="primary" icon={<ChevronRight size={18} />} disabled={!next} onClick={() => next && onNavigate(next.no)}>
              Sonraki
            </Button>
          </div>
        </main>
        <aside aria-label="Sorular" className="rounded-lg border border-line bg-surface-raised p-4">
          <AnswerGrid questions={questions} current={current} onSelect={onNavigate} />
        </aside>
      </div>
    </div>
  );
}
