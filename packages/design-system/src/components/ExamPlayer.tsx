'use client';

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Flag } from 'lucide-react';
import { cn } from '../lib/cn';
import { AnswerGrid, type AnswerGridItem } from './AnswerGrid';
import { Button } from './Button';
import { ProgressStrip, type StripStatus } from './ProgressStrip';
import { Timer } from './Timer';

export interface ExamPlayerProps extends Omit<ComponentPropsWithRef<'div'>, 'title' | 'onSelect'> {
  /**
   * 'practice' (varsayılan, sade test akışı): yalnız soru, şıklar, ilerleme noktaları ve "Sonraki"; zamanlayıcı, soru ızgarası,
   * Önceki ve Bayrakla yoktur. 'exam' (deneme kipi): Timer, AnswerGrid, Önceki, Bayrakla ve "Sınavı bitir" görünür.
   */
  mode?: 'practice' | 'exam';
  title: string;
  /** Başlık düzeyi; sayfanın kendi h1'iyle çakışmamak için varsayılan 2. */
  headingLevel?: 1 | 2 | 3;
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
 * yanda (mobilde altta) AnswerGrid (mode="exam"). Varsayılan sade akışta yalnız soru, ilerleme noktaları ve "Sonraki" vardır. Soru içeriği ve cevap durumu uygulamadan gelir.
 */
export function ExamPlayer({
  mode = 'practice',
  title,
  headingLevel = 2,
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
  const Heading = `h${headingLevel}` as const;
  const answered = questions.filter((q) => q.status === 'answered').length;
  const exam = mode === 'exam';

  if (!exam) {
    const statuses: StripStatus[] = questions.map((q) => (q.status === 'answered' ? 'answered' : q.status === 'flagged' ? 'flagged' : 'todo'));
    return (
      <div {...rest} data-mode="practice" className={cn('mx-auto flex w-full max-w-160 flex-col gap-4', className)}>
        <header className="flex flex-col gap-2">
          <Heading className="text-title-3 m-0 text-ink">{title}</Heading>
          <ProgressStrip total={questions.length} current={index >= 0 ? index + 1 : current} statuses={statuses} />
        </header>
        <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface-raised p-4" aria-label={`Soru ${current}`}>
          {children}
          <div className="mt-2 flex justify-end border-t border-line pt-3">
            {!next && onFinish ? (
              <Button variant="primary" onClick={onFinish}>
                Bitir
              </Button>
            ) : (
              <Button variant="primary" icon={<ChevronRight size={18} />} disabled={!next} onClick={() => next && onNavigate(next.no)}>
                Sonraki
              </Button>
            )}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div {...rest} className={cn('mx-auto flex w-full max-w-5xl flex-col gap-4', className)}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <Heading className="text-title-3 m-0 text-ink">{title}</Heading>
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
        <section className="flex min-w-0 flex-col gap-4 rounded-lg border border-line bg-surface-raised p-4" aria-label={`Soru ${current}`}>
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
        </section>
        <aside aria-label="Sorular" className="rounded-lg border border-line bg-surface-raised p-4">
          <AnswerGrid questions={questions} current={current} onSelect={onNavigate} />
        </aside>
      </div>
    </div>
  );
}
