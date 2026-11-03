'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Button, ModeToggle, TutorMessage } from '@/ds';
import { CHAT_COPY, type ChatBootstrap, type ChatMode, type DisplayMessage } from '@/lib/chat';
import mascot from '@ogrenmen/design-system/assets/Maskot/ogrenmen-maskot.webp';
import { Attachment } from './Attachment';
import { Composer, type PendingAttachment } from './Composer';
import { MessageBody } from './MessageBody';
import { prepareImage } from './image';
import { ChatRejected, sendChat, uploadAttachment, type ClientEvent } from './send';

export const MAX_ATTACHMENTS = 4;
/** Başka bir tur sürerken sayfa yenileme aralığı ve en uzun bekleme (sunucu turu en çok 120 sn). */
export const PENDING_POLL_MS = 3000;
const PENDING_MAX_MS = 130_000;
/** Koç avatarı: maskot (DS Avatar yüze kırpar). Testte görsel içe aktarımı düz yol olabilir. */
const MASCOT_SRC: string | undefined = typeof mascot === 'string' ? mascot : (mascot as { src?: string })?.src;

interface Item extends DisplayMessage {
  /** Yerel önizleme adresleri (gönderilen eklerin küçük resmi). */
  previews?: Record<string, string>;
  modeSuggestion?: ChatMode | null;
}

interface Live {
  /** İlk metin gelene dek yazıyor noktaları. */
  draft: string;
  /** Araç çağrısı sırasında kısa durum notu. */
  note: string | null;
}

export interface CoachChatProps {
  initial: ChatBootstrap;
  /** Mod değişikliğini kaydeder (sunucu eylemi; sohbet yoksa çağrılmaz). */
  saveMode?: (conversationId: string, mode: ChatMode) => Promise<unknown>;
  /** Testler için. */
  fetchImpl?: typeof fetch;
}

let localSeq = 0;
const localId = (p: string) => `${p}${Date.now().toString(36)}${(localSeq++).toString(36)}`;

/** Koç sohbeti (mockup S03): mesaj listesi, yazıyor göstergesi, ince mod seçici, alt giriş. */
export function CoachChat({ initial, saveMode, fetchImpl }: CoachChatProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [items, setItems] = useState<Item[]>(initial.messages);
  const [conversationId, setConversationId] = useState(initial.conversationId);
  const [mode, setMode] = useState<ChatMode>(initial.mode);
  const [text, setText] = useState(initial.seed ? CHAT_COPY.seedPrompt : '');
  const [attachments, setAttachmentsState] = useState<PendingAttachment[]>([]);
  // Eklerin güncel listesi (ref): üst üste iki seçim (kamera, sonra dosya) yeniden çizimden önce gelirse yer
  // hesabı bayat durumdan yapılmasın diye her güncelleme önce ref'e uygulanır.
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  const setAttachments = useCallback((next: PendingAttachment[] | ((a: PendingAttachment[]) => PendingAttachment[])) => {
    attachmentsRef.current = typeof next === 'function' ? next(attachmentsRef.current) : next;
    setAttachmentsState(attachmentsRef.current);
  }, []);
  const [seed, setSeed] = useState(initial.seed);
  const [live, setLive] = useState<Live | null>(null);
  // Önceki bir tur sürüyor (başka sekme ya da sayfadan ayrılıp dönme): yazıyor göstergesi, gönderim kapalı; sayfa
  // aralıklı yenilenir, tur bitince mesajlar sunucudan gelir.
  const [waiting, setWaiting] = useState(Boolean(initial.pending));
  const [error, setError] = useState<string | null>(initial.available ? null : CHAT_COPY.unavailable);
  const endRef = useRef<HTMLDivElement>(null);
  // Yerel önizlemeler: çizim için durum, sökülürken serbest bırakmak için ref.
  const [previewMap, setPreviewMap] = useState<Record<string, string>>({});
  const previews = useRef(new Map<string, string>());

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [items, live, waiting]);

  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const t = setInterval(() => {
      if (Date.now() - started > PENDING_MAX_MS) setWaiting(false);
      else router.refresh();
    }, PENDING_POLL_MS);
    return () => clearInterval(t);
  }, [waiting, router]);

  // Yenilenen sunucu durumu (router.refresh yeni `initial` verir): bekleme bittiyse mesajlar sunucudan alınır.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    if (waiting && !initial.pending) {
      setItems(initial.messages);
      if (initial.conversationId) setConversationId(initial.conversationId);
      setError((e) => (e === CHAT_COPY.turnInProgress ? null : e));
      setWaiting(false);
    }
  }

  useEffect(() => {
    const urls = previews.current;
    return () => {
      for (const u of urls.values()) URL.revokeObjectURL(u);
    };
  }, []);

  const changeMode = useCallback(
    (m: ChatMode) => {
      setMode(m);
      if (conversationId && saveMode) void saveMode(conversationId, m).catch(() => undefined);
    },
    [conversationId, saveMode],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      const room = Math.max(0, MAX_ATTACHMENTS - attachmentsRef.current.length);
      if (files.length > room) setError(CHAT_COPY.tooManyAttachments(MAX_ATTACHMENTS));
      // Yer, yüklemeler başlamadan bir kerede ayrılır (yer tutucular hemen listeye girer).
      const picked = files.slice(0, room).map((f) => {
        const tmp = localId('u');
        const kind: PendingAttachment['kind'] = f.type === 'application/pdf' ? 'pdf' : 'photo';
        const url = kind === 'photo' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : null;
        if (url) previews.current.set(tmp, url);
        return { f, tmp, url, item: { id: tmp, kind, previewUrl: url, name: f.name, uploading: true } as PendingAttachment };
      });
      if (picked.length === 0) return;
      setAttachments((a) => [...a, ...picked.map((p) => p.item)]);
      for (const { f, tmp, url } of picked) {
        try {
          const prepared = await prepareImage(f);
          const res = await uploadAttachment(prepared.file, prepared, fetchImpl);
          if (url) {
            previews.current.set(res.id, url);
            setPreviewMap((p) => ({ ...p, [res.id]: url }));
          }
          setAttachments((a) => a.map((x) => (x.id === tmp ? { ...x, id: res.id, kind: res.kind, uploading: false } : x)));
        } catch (err) {
          const msg = err instanceof ChatRejected ? err.message : CHAT_COPY.uploadError;
          setAttachments((a) => a.map((x) => (x.id === tmp ? { ...x, uploading: false, error: msg } : x)));
        }
      }
    },
    [fetchImpl, setAttachments],
  );

  const removeAttachment = useCallback((id: string) => setAttachments((a) => a.filter((x) => x.id !== id)), [setAttachments]);

  const send = useCallback(async () => {
    const body = text.trim();
    const ready = attachments.filter((a) => !a.uploading && !a.error);
    if (live || waiting || (!body && ready.length === 0 && !seed)) return;
    const studentItem: Item = {
      id: localId('s'),
      from: 'student',
      text: body,
      attachments: [...ready.map((a) => ({ id: a.id, kind: a.kind })), ...(seed?.attachments ?? [])],
      escalated: false,
      seeded: Boolean(seed),
      previews: Object.fromEntries(ready.filter((a) => a.previewUrl).map((a) => [a.id, a.previewUrl as string])),
    };
    const restore = { text, attachments, seed };
    setError(null);
    setText('');
    setAttachments([]);
    setItems((xs) => [...xs, studentItem]);
    setLive({ draft: '', note: null });
    let started = false;
    // Tur hiç başlamadı: mesaj kaydedilmedi, taslak geri gelir.
    const rollback = () => {
      setItems((xs) => xs.filter((x) => x.id !== studentItem.id));
      setText(restore.text);
      setAttachments(restore.attachments);
      setSeed(restore.seed);
    };
    const onEvent = (ev: ClientEvent) => {
      switch (ev.type) {
        case 'start':
          started = true;
          setConversationId(ev.conversationId);
          if (seed) {
            setSeed(null);
            router.replace(pathname);
          }
          break;
        case 'text':
          setLive((l) => ({ draft: (l?.draft ?? '') + ev.text, note: l?.note ?? null }));
          break;
        case 'tool':
          // Araçtan önceki kısa cümle durum notu olur; yanıt metni araç sonrası yeniden başlar.
          setLive((l) => ({ draft: '', note: l?.draft.trim() || l?.note || null }));
          break;
        case 'restart':
          setLive({ draft: '', note: null });
          break;
        case 'done':
          setLive(null);
          setItems((xs) => [
            ...xs,
            {
              id: ev.messageId ? `m${ev.messageId}` : localId('t'),
              from: 'tutor',
              text: ev.text,
              attachments: [],
              escalated: ev.escalated,
              seeded: false,
              modeSuggestion: ev.modeSuggestion,
            },
          ]);
          break;
        case 'error':
          setLive(null);
          if (started && ev.code === 'stream_closed') {
            // Akış koptu ama sunucu turu bitirip kaydeder: hata yerine bekleme (sayfa aralıklı yenilenir, yanıt gelir).
            setWaiting(true);
            break;
          }
          setError(ev.message);
          if (!started) rollback();
          break;
      }
    };
    try {
      await sendChat({ conversationId, text: body, uploadIds: ready.map((a) => a.id), mode, seed: seed?.id ?? null }, onEvent, fetchImpl);
    } catch (err) {
      setLive(null);
      if (started) {
        // Tur başladıktan sonra ağ koptu: sunucu turu yine tamamlar ve kaydeder; yanıt beklemeyle gelir.
        setWaiting(true);
        return;
      }
      const msg = err instanceof ChatRejected ? err.message : CHAT_COPY.genericError;
      setError(msg);
      rollback();
      // Başka bir sekmede tur sürüyor: bitene dek bekle (sayfa aralıklı yenilenir).
      if (err instanceof ChatRejected && err.code === 'turn_in_progress') setWaiting(true);
    }
  }, [text, attachments, live, waiting, seed, conversationId, mode, fetchImpl, router, pathname, setAttachments]);

  const removeSeed = useCallback(() => {
    setSeed(null);
    // Teşhissiz kalan hazır metin bağlamsız gitmesin.
    setText((t) => (t.trim() === CHAT_COPY.seedPrompt ? '' : t));
  }, []);

  const busy = live !== null || waiting;
  const empty = items.length === 0;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-12rem)] w-full max-w-3xl flex-col md:min-h-[calc(100dvh-3.5rem)]">
      <header className="mb-2 flex items-baseline gap-2">
        <h1 className="text-title-3 m-0 text-ink">Koç</h1>
        <span className="text-caption font-medium tracking-wide text-ink-muted">AI öğretmen</span>
      </header>

      <div role="log" aria-label="Öğrenmen ile sohbet" aria-busy={busy} className="flex flex-1 flex-col justify-end gap-6 py-2">
        {empty ? (
          <TutorMessage from="tutor" name="Öğrenmen" avatarSrc={MASCOT_SRC}>
            <MessageBody text={CHAT_COPY.welcome} />
          </TutorMessage>
        ) : null}
        {items.map((m) =>
          m.from === 'student' ? (
            <TutorMessage key={m.id} from="student" aria-label="Sen" className="max-w-[300px] sm:max-w-md">
              <span className="sr-only">Sen: </span>
              {m.attachments.length > 0 ? (
                <span className="mb-2 flex flex-wrap justify-end gap-2">
                  {m.attachments.map((a) => (
                    <Attachment key={a.id} a={{ ...a, previewUrl: m.previews?.[a.id] ?? previewMap[a.id] ?? null }} />
                  ))}
                </span>
              ) : null}
              {m.text ? <MessageBody text={m.text} /> : null}
              {m.seeded ? <span className="text-caption mt-1 block opacity-80">{CHAT_COPY.seedChip}</span> : null}
            </TutorMessage>
          ) : (
            <TutorMessage
              key={m.id}
              from="tutor"
              name="Öğrenmen" avatarSrc={MASCOT_SRC}
              className="max-w-[330px] sm:max-w-xl"
              actions={
                m.modeSuggestion || m.escalated ? (
                  <>
                    {m.escalated ? <span className="text-caption text-ink-muted">{CHAT_COPY.escalated}</span> : null}
                    {m.modeSuggestion && m.modeSuggestion !== mode ? (
                      <Button variant="quiet" size="sm" onClick={() => changeMode(m.modeSuggestion as ChatMode)}>
                        {CHAT_COPY.modeSuggestion(m.modeSuggestion)}
                      </Button>
                    ) : null}
                  </>
                ) : undefined
              }
            >
              <MessageBody text={m.text} />
            </TutorMessage>
          ),
        )}
        {waiting && !live ? (
          <TutorMessage from="tutor" name="Öğrenmen" avatarSrc={MASCOT_SRC} typing className="max-w-[330px] sm:max-w-xl">
            <MessageBody text="" />
          </TutorMessage>
        ) : null}
        {live ? (
          <div className="flex flex-col gap-1">
            {live.note ? <p className="text-caption m-0 ml-14 text-ink-muted">{live.note}</p> : null}
            <TutorMessage from="tutor" name="Öğrenmen" avatarSrc={MASCOT_SRC} typing={live.draft === ''} className="max-w-[330px] sm:max-w-xl">
              <MessageBody text={live.draft} />
            </TutorMessage>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[5] -mx-4 mt-2 flex flex-col gap-2 bg-surface px-4 pt-2 pb-3 md:bottom-0 md:mx-0 md:px-0">
        {error ? (
          <p role="alert" className="text-small m-0 rounded-md bg-danger-soft px-3 py-2 text-danger">
            {error}
          </p>
        ) : null}
        {seed ? (
          <div className="text-small flex items-start justify-between gap-2 rounded-md bg-ai-soft px-3 py-2 text-ink">
            <span>
              <span className="font-semibold">{CHAT_COPY.seedChip}.</span> {seed.summary ? <MessageBody text={seed.summary} /> : null}
            </span>
            <Button variant="quiet" size="sm" className="shrink-0" onClick={removeSeed}>
              Kaldır
            </Button>
          </div>
        ) : null}
        <ModeToggle
          value={mode}
          onChange={changeMode}
          label="Yanıt biçimi"
          disabled={!initial.available}
          className="flex w-full [&>button]:min-w-0 [&>button]:flex-1 [&>button]:items-center [&>button]:px-1.5 [&>button]:text-center [&>button]:text-[13px] [&>button]:leading-tight [&>button]:text-balance sm:[&>button]:text-[14px]"
        />
        <Composer
          value={text}
          onChange={setText}
          onSend={() => void send()}
          attachments={attachments}
          onAddFiles={(f) => void addFiles(f)}
          onRemoveAttachment={removeAttachment}
          busy={busy}
          disabled={!initial.available}
          maxAttachments={MAX_ATTACHMENTS}
        />
      </div>
    </div>
  );
}
