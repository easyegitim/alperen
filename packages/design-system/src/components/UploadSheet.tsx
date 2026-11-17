'use client';

import { useId, useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { cn } from '../lib/cn';
import { Button } from './Button';
import { CameraSheet, type CapturedItem } from './CameraSheet';

export type UploadKind = 'own_work' | 'school_exam';

export interface UploadSheetResult {
  kind: UploadKind;
  items: CapturedItem[];
}

export const UPLOAD_OPTIONS: ReadonlyArray<{ value: UploadKind; label: string; sub: string }> = [
  { value: 'own_work', label: 'Kendi çalışmam', sub: 'Çözdüğün sorular, defterin' },
  { value: 'school_exam', label: 'Okul denemesi', sub: 'Okulda yazdığın sınav' },
];

export interface UploadSheetProps extends Omit<ComponentPropsWithRef<'section'>, 'onSubmit' | 'title'> {
  onSubmit: (result: UploadSheetResult) => void;
  onCancel?: () => void;
  title?: string;
  busy?: boolean;
  maxFiles?: number;
  maxBytes?: number;
  accept?: string;
}

/**
 * "+ Yükle" alt sayfası: iki seçenek (Kendi çalışmam / Okul denemesi), ardından CameraSheet gövdesi ve "Gönder".
 * Gerisi (sayfa sınıflama, OCR, anahtar, teşhis) uygulamanın arka planda yaptığı iştir.
 */
export function UploadSheet({ onSubmit, onCancel, title = 'Ne yüklüyorsun?', busy, maxFiles, maxBytes, accept, className, ...rest }: UploadSheetProps) {
  const uid = useId();
  const [kind, setKind] = useState<UploadKind | null>(null);
  return (
    <section
      aria-label={title}
      {...rest}
      className={cn('box-border flex w-full max-w-160 flex-col gap-4 rounded-t-lg border border-line bg-surface-raised p-4 shadow-lg', className)}
    >
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="text-title-3 mb-2 p-0 text-ink">{title}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {UPLOAD_OPTIONS.map((o) => {
            const on = kind === o.value;
            return (
              <label
                key={o.value}
                htmlFor={`${uid}-${o.value}`}
                className={cn(
                  'flex min-h-11 cursor-pointer flex-col gap-0.5 rounded-md border px-4 py-3 has-[:focus-visible]:shadow-focus-ring',
                  on ? 'border-primary bg-primary-soft' : 'border-line-strong bg-surface-raised',
                )}
              >
                <span className="flex items-center gap-2">
                  <input
                    id={`${uid}-${o.value}`}
                    type="radio"
                    name={`${uid}-kind`}
                    value={o.value}
                    checked={on}
                    disabled={busy}
                    onChange={() => setKind(o.value)}
                    className="size-5 accent-primary"
                  />
                  <span className="text-label text-ink">{o.label}</span>
                </span>
                <span className="text-small ml-7 text-ink-muted">{o.sub}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      {kind ? (
        <CameraSheet
          title="Sayfaları ekle"
          submitLabel="Gönder"
          showSolutionToggle={false}
          onCancel={onCancel}
          busy={busy}
          maxFiles={maxFiles}
          maxBytes={maxBytes}
          accept={accept}
          className="max-w-none rounded-none border-0 bg-transparent p-0 shadow-none"
          onSubmit={({ items }) => onSubmit({ kind, items })}
        />
      ) : onCancel ? (
        <div className="flex justify-end">
          <Button variant="quiet" onClick={onCancel}>
            Vazgeç
          </Button>
        </div>
      ) : null}
    </section>
  );
}
