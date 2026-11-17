'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUp, Loader2 } from 'lucide-react';
import { TutorMessage } from '@/ds';
import { MessageBody } from '@/components/chat/MessageBody';
import { PARENT_COPY, type ParentItem } from '@/lib/parent';
import mascot from '@ogrenmen/design-system/assets/Maskot/ogrenmen-maskot.webp';
import { ParentRejected, sendParentChat, type ParentClientEvent } from './send';

const MASCOT_SRC: string | undefined = typeof mascot === 'string' ? mascot : (mascot as { src?: string })?.src;
/** Başka bir tur sürerken sayfa yenileme aralığı ve en uzun bekleme (sunucu turu en çok 120 sn). */
export const PARENT_PENDING_POLL_MS = 3000;
const PENDING_MAX_MS = 130_000;

export interface ParentChatProps {
  studentId: string;
  initial: { available: boolean; conversationId: string | null; messages: ParentItem[]; pending: boolean };
  /** Testler için. */
  fetchImpl?: typeof fetch;
}

/** Açılan rapor isteği: tek ince satır (rapor hazır olunca Özet'te görünür). */
function ReportNotes({ reports }: { reports: ParentItem['reports'] }) {
  if (!reports || reports.length === 0) return null;
  return (
    <>
      {reports.map((r) => (
        <p key={r.documentId} data-testid="rapor-istendi" className="text-caption m-0 ml-14 text-ink-muted">
          {r.title} istendi. Hazır olunca Özet’te görünür.
        </p>
      ))}
    </>
  );
}

let seq = 0;
const localId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Veli sohbeti (mockup S10b): klasik sohbet, akışlı yanıt; mod seçici, ek ve mikrofon yok. Başlıkta sade "AI öğretmen"
 * etiketi (başlığın kendisi sayfanın h1'idir), altta "Rapor iste" hızlı çipleri ve tek satır giriş.
 */
export function ParentChat({ studentId, initial, fetchImpl }: ParentChatProps) {
  const router = useRouter();
  const [items, setItems] = useState<ParentItem[]>(initial.messages);
  const [conversationId, setConversationId] = useState(initial.conversationId);
  const [text, setText] = useState('');
  const [live, setLive] = useState<{ draft: string; reports: ParentItem['reports'] } | null>(null);
  const [waiting, setWaiting] = useState(initial.pending);
  const [error, setError] = useState<string | null>(initial.available ? null : PARENT_COPY.chatUnavailable);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [items, live, waiting]);

  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > PENDING_MAX_MS) setWaiting(false);
      else router.refresh();
    }, PARENT_PENDING_POLL_MS);
    return () => clearInterval(t);
  }, [waiting, router]);

  // Yenilenen sunucu durumu: bekleme bittiyse mesajlar sunucudan alınır.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    if (waiting && !initial.pending) {
      setItems(initial.messages);
      if (initial.conversationId) setConversationId(initial.conversationId);
      setError((e) => (e === PARENT_COPY.chatBusy ? null : e));
      setWaiting(false);
    }
  }

  const busy = live !== null || waiting;

  const send = useCallback(
    async (override?: string) => {
      const body = (override ?? text).trim();
      if (busy || !initial.available || !body) return;
      const mine: ParentItem = { id: localId('s'), from: 'parent', text: body };
      const restoreText = text;
      setError(null);
      setText('');
      setItems((xs) => [...xs, mine]);
      setLive({ draft: '', reports: [] });
      let started = false;
      const turnReports: NonNullable<ParentItem['reports']> = [];
      const rollback = () => {
        setItems((xs) => xs.filter((x) => x.id !== mine.id));
        setText(restoreText);
      };
      const onEvent = (ev: ParentClientEvent) => {
        switch (ev.type) {
          case 'start':
            started = true;
            setConversationId(ev.conversationId);
            break;
          case 'text':
            setLive((l) => ({ draft: (l?.draft ?? '') + ev.text, reports: l?.reports ?? [] }));
            break;
          case 'tool':
          case 'restart':
            setLive((l) => ({ draft: '', reports: l?.reports ?? [] }));
            break;
          case 'report':
            turnReports.push({ documentId: ev.documentId, title: ev.title, kind: ev.kind });
            setLive((l) => ({ draft: l?.draft ?? '', reports: [...turnReports] }));
            break;
          case 'done':
            setLive(null);
            setItems((xs) => [...xs, { id: ev.messageId ? `m${ev.messageId}` : localId('t'), from: 'assistant', text: ev.text, ...(turnReports.length > 0 ? { reports: [...turnReports] } : {}) }]);
            break;
          case 'error':
            setLive(null);
            if (started && ev.code === 'stream_closed') {
              // Akış koptu ama sunucu turu bitirip kaydeder: hata yerine bekleme.
              setWaiting(true);
              break;
            }
            setError(ev.message);
            if (!started) rollback();
            break;
        }
      };
      try {
        await sendParentChat({ studentId, conversationId, text: body }, onEvent, fetchImpl);
      } catch (err) {
        setLive(null);
        if (started) {
          setWaiting(true);
          return;
        }
        setError(err instanceof ParentRejected ? err.message : PARENT_COPY.chatError);
        rollback();
        if (err instanceof ParentRejected && err.code === 'turn_in_progress') setWaiting(true);
      }
    },
    [text, busy, initial.available, studentId, conversationId, fetchImpl],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
  };

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-12rem)] w-full max-w-3xl flex-col md:min-h-[calc(100dvh-3.5rem)]">
      <div role="log" aria-label="Öğrenmen ile sohbet" aria-busy={busy} className="flex flex-1 flex-col justify-end gap-6 py-2">
        {items.length === 0 ? (
          <TutorMessage from="tutor" name="Öğrenmen" avatarSrc={MASCOT_SRC} className="max-w-[330px] sm:max-w-xl">
            <MessageBody text={PARENT_COPY.chatWelcome} />
          </TutorMessage>
        ) : null}
        {items.map((m) =>
          m.from === 'parent' ? (
            <TutorMessage key={m.id} from="student" aria-label="Siz" className="max-w-[300px] sm:max-w-md">
              <span className="sr-only">Siz: </span>
              <MessageBody text={m.text} />
            </TutorMessage>
          ) : (
            <div key={m.id} className="flex flex-col gap-1">
              <TutorMessage from="tutor" name="Öğrenmen" avatarSrc={MASCOT_SRC} className="max-w-[330px] sm:max-w-xl">
                <MessageBody text={m.text} />
              </TutorMessage>
              <ReportNotes reports={m.reports} />
            </div>
          ),
        )}
        {waiting && !live ? (
          <TutorMessage from="tutor" name="Öğrenmen" avatarSrc={MASCOT_SRC} typing className="max-w-[330px] sm:max-w-xl">
            <MessageBody text="" />
          </TutorMessage>
        ) : null}
        {live ? (
          <TutorMessage from="tutor" name="Öğrenmen" avatarSrc={MASCOT_SRC} typing={live.draft === ''} className="max-w-[330px] sm:max-w-xl">
            <MessageBody text={live.draft} />
          </TutorMessage>
        ) : null}
        {live ? <ReportNotes reports={live.reports} /> : null}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[5] -mx-4 mt-2 flex flex-col gap-2 bg-surface px-4 pt-2 pb-3 md:bottom-0 md:mx-0 md:px-0">
        {error ? (
          <p role="alert" className="text-small m-0 rounded-md bg-danger-soft px-3 py-2 text-danger">
            {error}
          </p>
        ) : null}
        <form onSubmit={submit} className="m-0 flex items-center gap-2" aria-label="Öğrenmen’e mesaj">
          <div className="flex min-w-0 flex-1 items-center rounded-full border border-line bg-surface-raised px-4 shadow-sm focus-within:shadow-focus-ring">
            <label className="sr-only" htmlFor="veli-mesaj">
              {PARENT_COPY.chatPlaceholder}
            </label>
            <input
              ref={inputRef}
              id="veli-mesaj"
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKey}
              placeholder={PARENT_COPY.chatPlaceholder}
              autoComplete="off"
              maxLength={2000}
              disabled={!initial.available}
              className="min-h-12 min-w-0 flex-1 border-0 bg-transparent text-[16px] leading-6 text-ink outline-none placeholder:text-ink-muted"
            />
          </div>
          <button
            type="submit"
            aria-label="Gönder"
            disabled={busy || !initial.available || text.trim() === ''}
            className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-primary text-on-primary shadow-sm hover:bg-primary-strong focus-visible:outline-none focus-visible:shadow-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" size={22} /> : <ArrowUp aria-hidden="true" size={22} />}
          </button>
        </form>
      </div>
    </div>
  );
}
