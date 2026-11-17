'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { ChangeEvent, ComponentPropsWithRef } from 'react';
import { Camera, FileText, ImagePlus, RotateCw, X } from 'lucide-react';
import { cn } from '../lib/cn';
import { Button } from './Button';

export type Rotation = 0 | 90 | 180 | 270;

export interface CapturedItem {
  id: string;
  file: File;
  /** Önizlemede ve gönderimde uygulanacak saat yönünde döndürme (derece). */
  rotation: Rotation;
  /** Dikdörtgen kırpma, görselin 0–1 oranlarıyla (x, y sol-üst köşe; w, h boyut). Yoksa kırpma yok. */
  crop?: { x: number; y: number; w: number; h: number };
}

export interface CameraSheetResult {
  items: CapturedItem[];
  /** "Çözümüm de var": yüklenen sayfalar öğrencinin kendi çözümünü de içeriyor. */
  includesSolution: boolean;
}

export interface CameraSheetProps extends Omit<ComponentPropsWithRef<'section'>, 'onSubmit' | 'title'> {
  onSubmit: (result: CameraSheetResult) => void;
  onCancel?: () => void;
  title?: string;
  /** En fazla sayfa sayısı. */
  maxFiles?: number;
  /** Dosya başına en fazla bayt. */
  maxBytes?: number;
  /** Galeri/dosya girişinin kabul ettiği türler. */
  accept?: string;
  /** Gönderim sürerken düğmeleri kilitler. */
  busy?: boolean;
  /** Gönder düğmesi metni (varsayılan "Soruyu gönder"). */
  submitLabel?: string;
  /** "Çözümüm de var" onay kutusunu gösterir (varsayılan açık); kapalıyken includesSolution hep false olur. */
  showSolutionToggle?: boolean;
}

const DEFAULT_MAX_BYTES = 15 * 1024 * 1024;

let seq = 0;
const nextId = () => `cap-${Date.now().toString(36)}-${++seq}`;

function previewUrl(file: File): string | undefined {
  if (!file.type.startsWith('image/')) return undefined;
  return typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : undefined;
}

/**
 * Soru yakalama: kamera ya da dosya girişi, çoklu sayfa, önizleme, döndürme ve "çözümüm de var" işareti.
 * Bir alt sayfa (sheet) gövdesi olarak tasarlanmıştır; konumlandırmayı (modal/çekmece) uygulama yapar.
 * Kırpma: her sayfa için üst/alt/sol/sağ kenar payı (en fazla %40) ayarlanır; sonuç CapturedItem.crop olarak döner.
 */
export function CameraSheet({
  onSubmit,
  onCancel,
  title = 'Soruyu yükle',
  maxFiles = 8,
  maxBytes = DEFAULT_MAX_BYTES,
  accept = 'image/*,application/pdf',
  busy,
  submitLabel = 'Soruyu gönder',
  showSolutionToggle = true,
  className,
  ...rest
}: CameraSheetProps) {
  const uid = useId();
  const [items, setItems] = useState<CapturedItem[]>([]);
  const [includesSolution, setIncludesSolution] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef(new Map<string, string>());
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const map = urls.current;
    return () => {
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        for (const u of map.values()) URL.revokeObjectURL(u);
      }
      map.clear();
    };
  }, []);

  const addFiles = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (picked.length === 0) return;
    const accepted: CapturedItem[] = [];
    let message: string | null = null;
    for (const file of picked) {
      if (items.length + accepted.length >= maxFiles) {
        message = `En fazla ${maxFiles} sayfa ekleyebilirsin.`;
        break;
      }
      if (file.size > maxBytes) {
        message = `${file.name} çok büyük; en fazla ${Math.round(maxBytes / (1024 * 1024))} MB olabilir.`;
        continue;
      }
      const id = nextId();
      const url = previewUrl(file);
      if (url) urls.current.set(id, url);
      accepted.push({ id, file, rotation: 0 });
    }
    setError(message);
    if (accepted.length) setItems((prev) => [...prev, ...accepted]);
  };

  const remove = (id: string) => {
    const u = urls.current.get(id);
    if (u && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(u);
    urls.current.delete(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
    setError(null);
  };

  const rotate = (id: string) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, rotation: ((i.rotation + 90) % 360) as Rotation } : i)));

  const setInset = (id: string, side: 'top' | 'bottom' | 'left' | 'right', pct: number) =>
    setItems((prev) =>
      prev.map((i) => {
        if (i.id !== id) return i;
        const cur = i.crop ?? { x: 0, y: 0, w: 1, h: 1 };
        const left = side === 'left' ? pct / 100 : cur.x;
        const top = side === 'top' ? pct / 100 : cur.y;
        const right = side === 'right' ? pct / 100 : 1 - cur.x - cur.w;
        const bottom = side === 'bottom' ? pct / 100 : 1 - cur.y - cur.h;
        const crop = { x: left, y: top, w: 1 - left - right, h: 1 - top - bottom };
        const none = left === 0 && top === 0 && right === 0 && bottom === 0;
        return { ...i, crop: none ? undefined : crop };
      }),
    );

  const full = items.length >= maxFiles;

  return (
    <section
      aria-label={title}
      {...rest}
      className={cn('box-border flex w-full max-w-160 flex-col gap-4 rounded-t-lg border border-line bg-surface-raised p-4 shadow-lg', className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-title-3 m-0 text-ink">{title}</h2>
        <span className="text-small text-ink-muted" aria-live="polite">
          {items.length} / {maxFiles} sayfa
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<Camera size={18} />} disabled={full || busy} onClick={() => cameraRef.current?.click()}>
          Fotoğraf çek
        </Button>
        <Button variant="secondary" icon={<ImagePlus size={18} />} disabled={full || busy} onClick={() => fileRef.current?.click()}>
          Dosyadan ekle
        </Button>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          hidden
          tabIndex={-1}
          aria-label="Kamerayla fotoğraf ekle"
          onChange={addFiles}
        />
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          multiple
          hidden
          tabIndex={-1}
          aria-label="Dosya seçerek ekle"
          onChange={addFiles}
        />
      </div>

      {error ? (
        <p role="alert" className="text-small m-0 text-danger">
          ✕ {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <div className="flex flex-col gap-2">
          <div
            data-testid="guide-frame"
            aria-hidden="true"
            className="relative mx-auto aspect-[4/3] w-full max-w-80 rounded-md border-2 border-dashed border-line-strong bg-surface-sunken"
          >
            <span className="absolute -top-0.5 -left-0.5 size-4 rounded-tl-md border-t-4 border-l-4 border-primary" />
            <span className="absolute -top-0.5 -right-0.5 size-4 rounded-tr-md border-t-4 border-r-4 border-primary" />
            <span className="absolute -bottom-0.5 -left-0.5 size-4 rounded-bl-md border-b-4 border-l-4 border-primary" />
            <span className="absolute -right-0.5 -bottom-0.5 size-4 rounded-br-md border-r-4 border-b-4 border-primary" />
          </div>
          <p className="text-small m-0 text-ink-muted">Soruyu çerçeveye sığdır, düz tut ve yazıların net göründüğünden emin ol. Birden çok sayfa ekleyebilirsin.</p>
        </div>
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
          {items.map((item, index) => {
            const url = urls.current.get(item.id);
            return (
              <li key={item.id} className="flex flex-col gap-2 rounded-md border border-line bg-surface-sunken p-2">
                <div className="relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-sm bg-paper">
                  {url ? (
                    <>
                      <img
                        src={url}
                        alt={`Sayfa ${index + 1} önizlemesi`}
                        className="max-h-full max-w-full object-contain"
                        style={{ transform: `rotate(${item.rotation}deg)` }}
                      />
                      {item.crop ? (
                        <span
                          aria-hidden="true"
                          data-testid="crop-frame"
                          className="pointer-events-none absolute border-2 border-dashed border-primary"
                          style={{
                            left: `${item.crop.x * 100}%`,
                            top: `${item.crop.y * 100}%`,
                            width: `${item.crop.w * 100}%`,
                            height: `${item.crop.h * 100}%`,
                          }}
                        />
                      ) : null}
                    </>
                  ) : (
                    <span className="text-small flex flex-col items-center gap-1 p-2 text-center text-navy">
                      <FileText aria-hidden="true" size={28} />
                      <span className="break-all">{item.file.name}</span>
                    </span>
                  )}
                </div>
                <span className="text-caption text-ink-muted">Sayfa {index + 1}</span>
                <div className="flex flex-wrap gap-1">
                  <Button
                    variant="quiet"
                    size="sm"
                    icon={<RotateCw size={16} />}
                    aria-label={`Sayfa ${index + 1} döndür`}
                    disabled={busy}
                    onClick={() => rotate(item.id)}
                  >
                    Döndür
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    icon={<X size={16} />}
                    aria-label={`Sayfa ${index + 1} kaldır`}
                    disabled={busy}
                    onClick={() => remove(item.id)}
                  >
                    Kaldır
                  </Button>
                </div>
                {url ? (
                  <fieldset className="m-0 grid grid-cols-2 gap-x-2 gap-y-1 border-0 p-0">
                    <legend className="text-caption mb-1 p-0 text-ink-muted">Kırp (kenar payı %)</legend>
                    {(
                      [
                        ['top', 'Üst', item.crop?.y ?? 0],
                        ['bottom', 'Alt', item.crop ? 1 - item.crop.y - item.crop.h : 0],
                        ['left', 'Sol', item.crop?.x ?? 0],
                        ['right', 'Sağ', item.crop ? 1 - item.crop.x - item.crop.w : 0],
                      ] as const
                    ).map(([side, lab, v]) => (
                      <label key={side} className="text-caption flex flex-col text-ink-muted">
                        {lab}
                        <input
                          type="range"
                          min={0}
                          max={40}
                          step={1}
                          value={Math.round(v * 100)}
                          disabled={busy}
                          aria-label={`Sayfa ${index + 1} ${lab.toLowerCase()} kırpma`}
                          onChange={(e) => setInset(item.id, side, Number(e.target.value))}
                          className="accent-primary"
                        />
                      </label>
                    ))}
                  </fieldset>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {showSolutionToggle ? (
      <label htmlFor={`${uid}-sol`} className="text-label flex min-h-11 cursor-pointer items-center gap-3 text-ink">
        <input
          id={`${uid}-sol`}
          type="checkbox"
          checked={includesSolution}
          onChange={(e) => setIncludesSolution(e.target.checked)}
          className="size-5 accent-primary"
        />
        Çözümüm de var
      </label>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button variant="quiet" onClick={onCancel} disabled={busy}>
            Vazgeç
          </Button>
        ) : null}
        <Button variant="primary" disabled={items.length === 0 || busy} onClick={() => onSubmit({ items, includesSolution: showSolutionToggle && includesSolution })}>
          {submitLabel}
        </Button>
      </div>
    </section>
  );
}
