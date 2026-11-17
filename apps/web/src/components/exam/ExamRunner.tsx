'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Check, Flag, LayoutGrid, Pencil, X } from 'lucide-react';
import { AnswerGrid, Button, cn, FigureFrame, MathText, Notice, QuizOption, TextField, Timer } from '@/ds';
import { finishExamAction, recordExamResponseAction, syncExamClockAction } from '@/server/exam/actions';
import { examCounts, examReducer, type ExamEvent, confirmText, countsLine, currentSlot, gridItems, initExam, isLastQuestion, snapshotOf } from '@/server/exam/machine';
import { loadQueue, ResponseQueue, type QueueStorage, type SendOutcome } from '@/server/exam/queue';
import { makeClock, remainingSec } from '@/server/exam/clock';
import type { ExamItem } from '@/server/exam/types';
import { CropView } from './CropView';
import { ScratchPad } from './ScratchPad';
import { Sheet } from './Sheet';

export interface ExamRunnerProps {
  sessionId: string;
  title: string;
  ownerId: string;
  items: ExamItem[];
  /** Sunucu durumu: bitiş sınırı ve yükleme anındaki sunucu saati (süre buradan türetilir). */
  deadlineAt: string | null;
  serverNow: string;
  expired: boolean;
  answers: Array<{ questionId: string; answer: string | null; flagged: boolean; hasWork: boolean }>;
}

const RETRY_MS = 4000;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function safeStorage(): QueueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Uygulama içi sınav oynatıcısı (mockup S04 + deneme kipi): üstte ince ilerleme ve mono zamanlayıcı, ortada soru, şekil ve
 * 5 şık; "İşaretle", "Karalama" ve "Sorular" (ızgara alt sayfası); altta tek birincil "Sonraki" (son soruda "Bitir").
 * Zamanlayıcı sunucunun bitiş sınırından türetilir (clock.ts) ve dolunca sınav kendiliğinden biter. Her değişiklik
 * çevrimdışı kuyruğa yazılır ve gönderilir (queue.ts); bitirmeden önce kuyruk boşaltılır.
 */
export function ExamRunner({ sessionId, title, ownerId, items, deadlineAt, serverNow, expired, answers }: ExamRunnerProps) {
  const router = useRouter();
  // İlk saat sayfa verisinden (indirme gecikmesini içerebilir); mount sonrası bir gidiş-dönüşle düzeltilir (aşağıda).
  const [clock, setClock] = useState(() => makeClock({ deadlineAt, serverNow, clientNow: Date.now() }));
  const [state, dispatch] = useReducer(examReducer, undefined, () => {
    // sunucudaki cevaplar + bu cihazda gönderilmemiş (kuyruktaki) cevaplar
    const queued = new Map(loadQueue(safeStorage(), sessionId).map((s) => [s.questionId, s]));
    const server = new Map(answers.map((a) => [a.questionId, a]));
    return initExam(
      items.map((i) => {
        const q = queued.get(i.questionId);
        const a = server.get(i.questionId);
        return { no: i.no, questionId: i.questionId, answer: q ? q.answer : (a?.answer ?? null), flagged: q ? q.flagged : (a?.flagged ?? false), hasWork: Boolean(a?.hasWork || q?.workUploadIds?.length) };
      }),
      Date.now(),
      { expired },
    );
  });
  // olaya o anın saatini ekler (render dışında okunur; durum makinesi saf kalır)
  // Açık uçlu cevap yerelde tutulur; 700 ms sessizlikte, odak kaybında, soru değişiminde ya da Bitir'de gönderilir.
  const [draft, setDraft] = useState<{ questionId: string; value: string } | null>(null);
  const draftRef = useRef<{ questionId: string; value: string } | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushDraft = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    const d = draftRef.current;
    if (!d) return;
    draftRef.current = null;
    setDraft(null);
    dispatch({ type: 'SELECT', value: d.value, at: Date.now() } as ExamEvent);
  }, []);
  const act = useCallback(
    (e: DistributiveOmit<ExamEvent, 'at'>) => {
      if (e.type !== 'SELECT') flushDraft();
      dispatch({ ...e, at: Date.now() } as ExamEvent);
    },
    [flushDraft],
  );
  const typeAnswer = (questionId: string, value: string) => {
    const d = { questionId, value };
    draftRef.current = d;
    setDraft(d);
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(flushDraft, 700);
  };
  useEffect(
    () => () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    },
    [],
  );
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const [remaining, setRemaining] = useState<number | null>(() => remainingSec(clock, Date.now()));
  const [pending, setPending] = useState(() => loadQueue(safeStorage(), sessionId).length);
  const queueRef = useRef<ResponseQueue | null>(null);
  const finishing = useRef(false);
  const sent = useRef<Map<string, { answer: string | null; flagged: boolean }> | null>(null);
  const [drawings, setDrawings] = useState<Record<string, string>>({});
  const [padOpen, setPadOpen] = useState(false);

  // --- kuyruk ---
  useEffect(() => {
    const q = new ResponseQueue(
      sessionId,
      safeStorage(),
      async (snap): Promise<SendOutcome> => {
        try {
          const r = await recordExamResponseAction({ sessionId, ...snap });
          if (r.ok) return { kind: 'ok' };
          return r.closed ? { kind: 'closed' } : { kind: 'retry' };
        } catch {
          return { kind: 'retry' };
        }
      },
      setPending,
    );
    queueRef.current = q;
    void q.flush();
    const onOnline = () => void q.flush();
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      queueRef.current = null;
    };
  }, [sessionId]);

  // bekleyen kayıt varken aralıklı yeniden dene
  useEffect(() => {
    if (pending === 0) return;
    const id = setInterval(() => void queueRef.current?.flush(), RETRY_MS);
    return () => clearInterval(id);
  }, [pending]);

  // cevap/işaret değişince kuyruğa yaz (süre tek başına yazım üretmez)
  useEffect(() => {
    if (!sent.current) {
      sent.current = new Map(answers.map((a) => [a.questionId, { answer: a.answer, flagged: a.flagged }]));
    }
    for (const s of state.slots) {
      const prev = sent.current.get(s.questionId) ?? { answer: null, flagged: false };
      if (prev.answer !== s.answer || prev.flagged !== s.flagged) {
        sent.current.set(s.questionId, { answer: s.answer, flagged: s.flagged });
        queueRef.current?.enqueue(snapshotOf(s));
        void queueRef.current?.flush();
      }
    }
  }, [state.slots, answers]);

  // sorudan çıkarken soruda geçen süre de kaydedilir
  const prevIndex = useRef(state.index);
  useEffect(() => {
    const was = prevIndex.current;
    prevIndex.current = state.index;
    if (was === state.index) return;
    const s = state.slots[was];
    if (s && (s.answer !== null || s.flagged)) {
      queueRef.current?.enqueue(snapshotOf(s));
      void queueRef.current?.flush();
    }
  }, [state.index, state.slots]);

  // --- saat eşitleme: tek gidiş-dönüş (exam_clock, salt okur), sunucu saati istek ile yanıtın ortasına denk sayılır.
  // Süresi sayfa açılışında dolmuşsa atlanır: oynatıcı zaten bitiriyor, sunucu yanıtı bir şey değiştirmez. ---
  useEffect(() => {
    if (expired || deadlineAt === null) return;
    let live = true;
    const t0 = Date.now();
    void syncExamClockAction(sessionId)
      .then((r) => {
        if (!live || !r) return;
        setClock(makeClock({ deadlineAt: r.deadlineAt ?? deadlineAt, serverNow: r.serverNow, clientNow: (t0 + Date.now()) / 2 }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [sessionId, deadlineAt, expired]);

  // ekran okuyucu için süre uyarısı (eşik başına bir kez)
  const [announce, setAnnounce] = useState('');
  const warned = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (remaining === null || remaining <= 0) return;
    for (const [th, text] of [[60, 'Bir dakika kaldı.'], [300, 'Beş dakika kaldı.']] as const) {
      if (remaining <= th && !warned.current.has(th)) {
        // başlangıçta zaten eşiğin altındaysa yalnız en yakın eşik söylenir
        for (const t of [60, 300]) if (t >= th) warned.current.add(t);
        setAnnounce(text);
        break;
      }
    }
  }, [remaining]);

  // --- zamanlayıcı ---
  useEffect(() => {
    if (clock.deadlineMs === null) return;
    const tick = () => {
      const r = remainingSec(clock, Date.now());
      setRemaining(r);
      if (r !== null && r <= 0) act({ type: 'TIME_UP' });
    };
    tick();
    const id = setInterval(tick, 500);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [clock, act]);

  // --- bitiş: önce kuyruk boşalır, sonra finish_exam_session ---
  useEffect(() => {
    if (state.phase !== 'finishing' || finishing.current) return;
    finishing.current = true;
    void (async () => {
      const q = queueRef.current;
      try {
        for (let i = 0; i < 3 && q && q.pending > 0 && !q.closed; i++) {
          if (await q.flush()) break;
          await new Promise((r) => setTimeout(r, 1200));
        }
        if (q && q.pending > 0 && !q.closed) {
          finishing.current = false;
          dispatch({ type: 'FINISH_FAILED', message: 'Bağlantı yok. Cevapların bu cihazda saklı; bağlantı gelince yeniden dene.' });
          return;
        }
        const r = await finishExamAction(sessionId);
        if (r.ok) {
          dispatch({ type: 'FINISHED' });
          router.replace(r.href);
        } else {
          finishing.current = false;
          dispatch({ type: 'FINISH_FAILED', message: r.message });
        }
      } catch {
        finishing.current = false;
        dispatch({ type: 'FINISH_FAILED', message: 'Sonucu alamadım. Yeniden dene.' });
      }
    })();
  }, [state.phase, sessionId, router]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [state.index]);

  const item = items.find((i) => i.no === currentSlot(state)?.no);
  const slot = currentSlot(state);
  const counts = examCounts(state);
  const total = counts.total;
  const locked = state.phase !== 'answering';
  const last = isLastQuestion(state);
  const closing = state.phase === 'finishing' || state.phase === 'done';

  if (closing || state.phase === 'error') {
    return (
      <div className="mx-auto flex min-h-[calc(100dvh-48px)] w-full max-w-xl flex-col items-center justify-center gap-6 text-center" aria-live="polite">
        {state.phase === 'error' ? (
          <>
            <p className="text-body m-0 text-ink">{state.error}</p>
            <Button variant="primary" size="lg" onClick={() => dispatch({ type: 'RETRY_FINISH' })}>
              Yeniden dene
            </Button>
          </>
        ) : (
          <p className="text-title-3 m-0 text-ink">{remaining === 0 ? 'Süre doldu. Sonucunu hazırlıyorum…' : 'Sonucunu hazırlıyorum…'}</p>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-48px)] w-full max-w-xl flex-col">
      <p className="sr-only" aria-live="polite" role="status" data-sheet-keep data-testid="sure-uyari">
        {announce}
      </p>
      <header className="flex flex-col gap-2 pt-2">
        <div className="grid min-h-12 grid-cols-[44px_1fr_auto] items-center gap-2">
          <Link href="/ogrenci" aria-label="Kapat (sınav sürer)" className="inline-flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-surface-sunken hover:text-ink">
            <X aria-hidden="true" size={24} strokeWidth={1.75} />
          </Link>
          <p className="text-small m-0 truncate text-center text-ink-muted" data-testid="sinav-baslik">
            {title}
          </p>
          {remaining !== null ? <Timer remainingSec={remaining} className="font-mono" data-testid="sayac" /> : <span aria-hidden="true" />}
        </div>
        <div
          role="progressbar"
          aria-label={`${total} sorudan ${counts.answered} tanesi cevaplandı`}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={counts.answered}
          className="h-1 w-full overflow-hidden rounded-full bg-line"
          data-testid="ilerleme"
        >
          <div className="h-full bg-primary transition-[width]" style={{ width: `${total ? (counts.answered / total) * 100 : 0}%` }} />
        </div>
      </header>

      {item && slot ? (
        <>
          <div className="flex flex-1 flex-col gap-6 pt-6 pb-6">
            <p className="text-small m-0 text-ink-muted" data-testid="soru-no">
              Soru {slot.no} / {total}
            </p>
            <div className="flex flex-col gap-6">
              {item.stem ? (
                <h1 id="soru" className="text-title-3 m-0 text-ink" data-testid="soru">
                  <MathText>{item.stem}</MathText>
                </h1>
              ) : (
                <h1 id="soru" className="text-title-3 m-0 text-ink">
                  Soru {slot.no}
                </h1>
              )}
              {item.crop ? <CropView crop={item.crop} label={`Soru ${slot.no}, kitapçık sayfasından`} /> : null}
              {item.figure ? <FigureFrame src={item.figure.src} alt={item.figure.alt} className="w-full" /> : null}
            </div>

            {item.kind === 'mcq' ? (
              <div
                role="radiogroup"
                aria-labelledby="soru"
                className="flex flex-col gap-2.5"
                onKeyDown={(e) => {
                  const keys = item.options.map((o) => o.key);
                  const at = keys.indexOf(slot.answer ?? '');
                  const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
                  if (!step || locked || keys.length === 0) return;
                  e.preventDefault();
                  const next = at < 0 ? (step > 0 ? 0 : keys.length - 1) : (at + step + keys.length) % keys.length;
                  act({ type: 'SELECT', value: keys[next]! });
                  e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
                }}
              >
                {item.options.map((o, idx) => {
                  const sel = slot.answer === o.key;
                  const tabStop = slot.answer == null ? idx === 0 : sel;
                  return (
                    <QuizOption
                      key={o.key}
                      letter={o.key}
                      role="radio"
                      aria-pressed={undefined}
                      aria-checked={sel}
                      aria-label={o.text === null ? `Şık ${o.key}` : undefined}
                      tabIndex={tabStop ? 0 : -1}
                      state={sel ? 'selected' : 'idle'}
                      disabled={locked}
                      onClick={() => act({ type: 'CHOOSE', value: o.key })}
                    >
                      {o.text === null ? null : <MathText>{o.text}</MathText>}
                    </QuizOption>
                  );
                })}
              </div>
            ) : (
              // Sayısal cevapta eksi işareti ve virgül gerekebileceğinden sayı klavyesi (decimal) verilmez: iOS'ta eksi yoktur.
              <TextField
                label="Cevabın"
                autoComplete="off"
                value={draft && draft.questionId === slot.questionId ? draft.value : (slot.answer ?? '')}
                disabled={locked}
                onChange={(e) => typeAnswer(slot.questionId, e.target.value)}
                onBlur={flushDraft}
                mono
              />
            )}

            <div className="grid grid-cols-3 gap-2">
              <Button variant={slot.flagged ? 'primary' : 'secondary'} aria-pressed={slot.flagged} icon={<Flag size={18} />} disabled={locked} onClick={() => act({ type: 'TOGGLE_FLAG' })}>
                İşaretle
              </Button>
              <Button
                variant="secondary"
                icon={slot.hasWork ? <Check size={18} /> : <Pencil size={18} />}
                aria-label={slot.hasWork ? 'Karalama, kaydedildi' : 'Karalama'}
                disabled={locked}
                onClick={() => setPadOpen(true)}
              >
                Karalama
              </Button>
              <Button variant="secondary" icon={<LayoutGrid size={18} />} disabled={locked} onClick={() => act({ type: 'OPEN_GRID' })}>
                Sorular
              </Button>
            </div>

            {pending > 0 ? (
              <Notice tone="info" live>
                {pending === 1 ? '1 cevap henüz gönderilmedi; bağlantı gelince kendiliğinden gider.' : `${pending} cevap henüz gönderilmedi; bağlantı gelince kendiliğinden gider.`}
              </Notice>
            ) : null}
          </div>

          <footer className={cn('sticky bottom-0 flex gap-3 bg-surface pt-4 pb-6')}>
            {state.index > 0 ? (
              <Button variant="quiet" size="lg" disabled={locked} onClick={() => act({ type: 'PREV' })}>
                Önceki
              </Button>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              block
              disabled={locked}
              onClick={() => act(last ? { type: 'ASK_FINISH' } : { type: 'NEXT' })}
            >
              {last ? 'Bitir' : 'Sonraki'}
            </Button>
          </footer>
        </>
      ) : null}

      {state.gridOpen ? (
        <Sheet label="Sorular" onClose={() => dispatch({ type: 'CLOSE_GRID' })}>
          <p className="text-body m-0 text-ink" data-testid="izgara-ozet">
            {countsLine(counts)}
          </p>
          <AnswerGrid questions={gridItems(state)} current={slot?.no} onSelect={(no) => act({ type: 'GO', no })} />
          <Button variant="secondary" size="lg" block onClick={() => act({ type: 'ASK_FINISH' })}>
            Sınavı bitir
          </Button>
        </Sheet>
      ) : null}

      {state.phase === 'confirming' ? (
        <Sheet label="Sınavı bitir" onClose={() => act({ type: 'CANCEL_FINISH' })}>
          <p className="text-body m-0 text-ink" data-testid="bitir-onay">
            {confirmText(counts)}
          </p>
          {counts.flagged > 0 ? <p className="text-small m-0 text-ink-muted">{counts.flagged} soru işaretli.</p> : null}
          <div className="flex gap-3">
            <Button variant="quiet" size="lg" onClick={() => act({ type: 'CANCEL_FINISH' })}>
              Geri dön
            </Button>
            <Button variant="primary" size="lg" block onClick={() => act({ type: 'CONFIRM_FINISH' })}>
              Bitir
            </Button>
          </div>
        </Sheet>
      ) : null}

      {padOpen && slot && item ? (
        <ScratchPad
          drawing={drawings[slot.questionId] ?? null}
          ownerId={ownerId}
          hasSaved={slot.hasWork}
          onClose={(url) => {
            if (url) setDrawings((d) => ({ ...d, [slot.questionId]: url }));
            setPadOpen(false);
          }}
          onSaved={(uploadId) => {
            const cur = stateRef.current.slots.find((s) => s.questionId === slot.questionId);
            if (cur) {
              queueRef.current?.enqueue({ ...snapshotOf(cur), workUploadIds: [uploadId] });
              void queueRef.current?.flush();
            }
            act({ type: 'WORK_SAVED' });
          }}
        />
      ) : null}
    </div>
  );
}
