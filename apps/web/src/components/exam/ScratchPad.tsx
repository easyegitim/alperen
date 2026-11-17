'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/ds';
import { createSupabaseBrowserClient } from '@/lib/supabase/browser';
import { registerCanvasUpload } from '@/server/exam/actions';
import { Sheet } from './Sheet';

export interface ScratchPadProps {
  /** Kayıtlı çizimlerin anahtarı: aynı soruya dönülünce kaldığı yerden sürer (yalnız bellekte). */
  drawing: string | null;
  ownerId: string;
  onClose: (dataUrl: string | null) => void;
  /** PNG yüklenip uploads satırı yazılınca çağrılır. */
  onSaved: (uploadId: string) => void;
  /** Bu soruda daha önce kaydedilmiş bir karalama var (yeni kayıt onun yerine geçer). */
  hasSaved?: boolean;
}

const W = 600;
const H = 400;

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Karalama tuvali (alt sayfa): parmak/kalemle çizilir. "Kaydet" PNG'yi öğrencinin kendi klasörüne yükler (uploads kovası),
 * uploads satırını kind='canvas' yazar ve kimliği soruya bağlar (exam_responses.work_upload_ids). Yanlış ya da boş çıkan
 * soruda bu görsel "nereye kadar geldim" teşhisine girer.
 */
export function ScratchPad({ drawing, ownerId, onClose, onSaved, hasSaved = false }: ScratchPadProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawingNow = useRef(false);
  const dirty = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // kaydedilmemiş çizimle kapatma isteği: çizim kaybolmadan önce öğrenciye sorulur
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    if (drawing) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, W, H);
      img.src = drawing;
    }
  }, [drawing]);

  const point = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }, []);

  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drawingNow.current = true;
    const p = point(e);
    ctx.strokeStyle = '#0b1b4d';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01);
    ctx.stroke();
    dirty.current = true;
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingNow.current) return;
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function up() {
    drawingNow.current = false;
  }

  function clear() {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    dirty.current = true;
  }

  // Esc, arka plan, Kapat: kaydedilmemiş çizim varsa önce sorulur; yoksa önceki (kayıtlı ya da boş) durum döner.
  function requestClose() {
    if (busy) return;
    if (dirty.current) {
      setConfirmDiscard(true);
      return;
    }
    onClose(drawing);
  }

  async function save() {
    const c = ref.current;
    if (!c || busy) return;
    setBusy(true);
    setError(null);
    try {
      const blob: Blob | null = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('png');
      const id = newId();
      const path = `${ownerId}/${id}.png`;
      const supabase = createSupabaseBrowserClient();
      const up = await supabase.storage.from('uploads').upload(path, blob, { contentType: 'image/png', upsert: false });
      if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error('upload');
      const reg = await registerCanvasUpload({ id, path, bytes: blob.size, width: W, height: H });
      if (!reg.ok) throw new Error(reg.message);
      onSaved(id);
      onClose(c.toDataURL('image/png'));
    } catch {
      setError('Karalama kaydedilemedi. Bağlantını kontrol edip yeniden dene.');
      setBusy(false);
    }
  }

  return (
    <Sheet label="Karalama" onClose={requestClose}>
      <p id="karalama-not" className="text-small m-0 text-ink-muted">
        Karalama isteğe bağlıdır; atlayabilirsin.
        {hasSaved ? ' Bu soruda daha önce kaydedilmiş bir karalama var; yeni kayıt onun yerine geçer.' : null}
      </p>
      <canvas
        ref={ref}
        width={W}
        height={H}
        data-testid="karalama-tuvali"
        aria-label="Karalama alanı: parmağın ya da kalemle çiz"
        aria-describedby="karalama-not"
        role="application"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="w-full touch-none rounded-md border border-line-strong bg-white"
        style={{ aspectRatio: `${W} / ${H}` }}
      />
      {error ? (
        <p role="alert" className="text-small m-0 text-danger">
          {error}
        </p>
      ) : null}
      {confirmDiscard ? (
        <div role="alertdialog" aria-label="Kaydedilmemiş çizim" className="flex flex-col gap-3 rounded-md border border-line bg-surface p-4" data-testid="karalama-vazgec">
          <p className="text-body m-0 text-ink">Kaydetmediğin bir çizim var. Kaydetmeden çıkarsan çizim gider.</p>
          <div className="flex gap-3">
            <Button variant="quiet" size="lg" onClick={() => setConfirmDiscard(false)} disabled={busy}>
              Geri dön
            </Button>
            <Button variant="secondary" size="lg" onClick={() => onClose(drawing)} disabled={busy}>
              Vazgeç
            </Button>
            <Button variant="primary" size="lg" block onClick={save} disabled={busy}>
              Kaydet
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3">
          <Button variant="secondary" size="lg" onClick={clear} disabled={busy}>
            Temizle
          </Button>
          <Button variant="primary" size="lg" block onClick={save} aria-busy={busy || undefined} disabled={busy}>
            Kaydet
          </Button>
        </div>
      )}
    </Sheet>
  );
}
