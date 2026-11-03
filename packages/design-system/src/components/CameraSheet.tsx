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
 * Kırpma bu sürümde yok (bilinen boşluk).
 */
export function CameraSheet({
  onSubmit,
  onCancel,
  title = 'Soruyu yükle',
  maxFiles = 8,
  maxBytes = DEFAULT_MAX_BYTES,
  accept = 'image/*,application/pdf',
  busy,
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
          tabIndex={-1}
          aria-label="Kamerayla fotoğraf ekle"
          className="sr-only"
          onChange={addFiles}
        />
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          multiple
          tabIndex={-1}
          aria-label="Dosya seçerek ekle"
          className="sr-only"
          onChange={addFiles}
        />
      </div>

      {error ? (
        <p role="alert" className="text-small m-0 text-danger">
          ✕ {error}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="text-small m-0 text-ink-muted">Soruyu çerçeveye sığdır, düz tut ve yazıların net göründüğünden emin ol. Birden çok sayfa ekleyebilirsin.</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
          {items.map((item, index) => {
            const url = urls.current.get(item.id);
            return (
              <li key={item.id} className="flex flex-col gap-2 rounded-md border border-line bg-surface-sunken p-2">
                <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded-sm bg-paper">
                  {url ? (
                    <img
                      src={url}
                      alt={`Sayfa ${index + 1} önizlemesi`}
                      className="max-h-full max-w-full object-contain"
                      style={{ transform: `rotate(${item.rotation}deg)` }}
                    />
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
              </li>
            );
          })}
        </ul>
      )}

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

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <Button variant="quiet" onClick={onCancel} disabled={busy}>
            Vazgeç
          </Button>
        ) : null}
        <Button variant="primary" disabled={items.length === 0 || busy} onClick={() => onSubmit({ items, includesSolution })}>
          Soruyu gönder
        </Button>
      </div>
    </section>
  );
}
