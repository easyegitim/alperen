'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowUp, Camera, FileUp, Loader2, Plus, X } from 'lucide-react';
import { Attachment, type AttachmentView } from './Attachment';

export interface PendingAttachment extends AttachmentView {
  /** Yükleniyor mu (sunucu kimliği henüz yok). */
  uploading: boolean;
  error?: string | null;
}

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  attachments: readonly PendingAttachment[];
  onAddFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  /** Yanıt beklenirken gönderim kapalı (yazmak açık). */
  busy: boolean;
  disabled?: boolean;
  maxAttachments: number;
}

const ICON_BTN =
  'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-ink-muted hover:bg-surface-sunken hover:text-ink focus-visible:outline-none focus-visible:shadow-focus-ring disabled:cursor-not-allowed disabled:opacity-50';

/** Alt giriş (mockup S03): + ekle (kamera/dosya), "Koça yaz", Gönder. Mikrofon ileride: şimdilik çizilmez. */
export function Composer({ value, onChange, onSend, attachments, onAddFiles, onRemoveAttachment, busy, disabled, maxAttachments }: ComposerProps) {
  const [menu, setMenu] = useState(false);
  const camRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Metin alanı içeriğe göre büyür (en çok 6 satır).
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 6 * 24 + 20)}px`;
  }, [value]);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent | globalThis.KeyboardEvent) => {
      if (e instanceof globalThis.KeyboardEvent ? e.key === 'Escape' : !menuRef.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);

  const uploading = attachments.some((a) => a.uploading);
  const ready = attachments.filter((a) => !a.uploading && !a.error);
  const canSend = !disabled && !busy && !uploading && (value.trim() !== '' || ready.length > 0);
  const full = attachments.length >= maxAttachments;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (canSend) onSend();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  const pick = (input: HTMLInputElement | null) => {
    setMenu(false);
    input?.click();
  };
  const onFiles = (list: FileList | null) => {
    if (list && list.length > 0) onAddFiles(Array.from(list));
  };

  return (
    <form onSubmit={submit} className="m-0 flex flex-col gap-2" aria-label="Koça mesaj">
      {attachments.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Ekler">
          {attachments.map((a) => (
            <li key={a.id} className="relative">
              <Attachment a={a} size="sm" />
              {a.uploading ? (
                <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-surface/60">
                  <Loader2 aria-label="Yükleniyor" className="animate-spin text-primary" size={20} />
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onRemoveAttachment(a.id)}
                aria-label="Eki kaldır"
                className="absolute -top-2 -right-2 flex size-6 cursor-pointer items-center justify-center rounded-full border-0 bg-navy text-on-navy"
              >
                <X aria-hidden="true" size={14} />
              </button>
              {a.error ? <span className="text-caption mt-1 block max-w-24 text-danger">{a.error}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-end gap-2">
        <div className="relative flex min-w-0 flex-1 items-end gap-1 rounded-[26px] border border-line bg-surface-raised px-1 py-0.5 shadow-sm focus-within:shadow-focus-ring">
          <div ref={menuRef} className="relative">
            <button
              type="button"
              className={ICON_BTN}
              aria-label="Fotoğraf veya dosya ekle"
              aria-haspopup="menu"
              aria-expanded={menu}
              disabled={disabled || full}
              onClick={() => setMenu((m) => !m)}
            >
              <Plus aria-hidden="true" size={22} />
            </button>
            {menu ? (
              <div role="menu" className="absolute bottom-12 left-0 z-20 flex w-48 flex-col rounded-md bg-surface-raised p-1 shadow-lg ring-1 ring-line">
                <button role="menuitem" type="button" onClick={() => pick(camRef.current)} className="text-label flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border-0 bg-transparent px-3 text-left text-ink hover:bg-surface-sunken">
                  <Camera aria-hidden="true" size={18} /> Fotoğraf çek
                </button>
                <button role="menuitem" type="button" onClick={() => pick(fileRef.current)} className="text-label flex min-h-11 cursor-pointer items-center gap-3 rounded-sm border-0 bg-transparent px-3 text-left text-ink hover:bg-surface-sunken">
                  <FileUp aria-hidden="true" size={18} /> Dosya seç
                </button>
              </div>
            ) : null}
            <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} data-testid="koc-kamera" />
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} data-testid="koc-dosya" />
          </div>
          <label className="sr-only" htmlFor="koc-mesaj">Koça yaz</label>
          <textarea
            ref={areaRef}
            id="koc-mesaj"
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKey}
            placeholder="Koça yaz"
            autoComplete="off"
            disabled={disabled}
            className="min-h-11 min-w-0 flex-1 resize-none border-0 bg-transparent py-2.5 text-[16px] leading-6 text-ink outline-none placeholder:text-ink-muted"
          />
        </div>
        <button
          type="submit"
          aria-label="Gönder"
          disabled={!canSend}
          className="flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-primary text-on-primary shadow-sm hover:bg-primary-strong focus-visible:outline-none focus-visible:shadow-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" size={22} /> : <ArrowUp aria-hidden="true" size={22} />}
        </button>
      </div>
    </form>
  );
}
