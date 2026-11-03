import { useEffect, useRef, useState } from 'react';
import type { ComponentPropsWithRef } from 'react';
import { Clock } from 'lucide-react';
import { cn } from '../lib/cn';
import { formatClock } from '../lib/format';

export interface TimerProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  /** Kalan süre (sn). */
  remainingSec: number;
  /** Bu değerin altında "Süre azalıyor" uyarısı (varsayılan 5 dk). */
  warnBelowSec?: number;
  label?: string;
}

/** Sınav sayacı: kalan süre mm:ss; azalınca uyarı kelimeyle yazılır. Güncellemeleri ekran okuyucuya sürekli okutmaz. */
export function Timer({ remainingSec, warnBelowSec = 300, label = 'Kalan süre', className, ...rest }: TimerProps) {
  const low = remainingSec <= warnBelowSec;
  const over = remainingSec <= 0;
  return (
    <div
      role="timer"
      aria-label={label}
      {...rest}
      className={cn(
        'text-label inline-flex min-h-11 items-center gap-2 rounded-md border px-3 tabular-nums',
        low ? 'border-warning bg-warning-soft text-warning' : 'border-line bg-surface-raised text-ink',
        className,
      )}
    >
      <Clock aria-hidden="true" size={18} />
      <span className="font-semibold">{formatClock(remainingSec)}</span>
      {over ? <span className="text-small">Süre doldu</span> : low ? <span className="text-small">Süre azalıyor</span> : null}
    </div>
  );
}

export interface UseCountdownOptions {
  running?: boolean;
  onExpire?: () => void;
}

/**
 * Geri sayım kancası. Duvar saatine (Date.now) dayanır; sekme arka plandayken sapmaz.
 * Dönen değer kalan saniyedir (tam sayı).
 */
export function useCountdown(totalSec: number, { running = true, onExpire }: UseCountdownOptions = {}): number {
  const [remaining, setRemaining] = useState(totalSec);
  const deadline = useRef<number | null>(null);
  const expired = useRef(false);
  const onExpireRef = useRef(onExpire);
  useEffect(() => {
    onExpireRef.current = onExpire;
  });

  useEffect(() => {
    if (!running) {
      deadline.current = null;
      return;
    }
    deadline.current = Date.now() + remaining * 1000;
    const id = setInterval(() => {
      if (deadline.current === null) return;
      const left = Math.max(0, Math.ceil((deadline.current - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0 && !expired.current) {
        expired.current = true;
        onExpireRef.current?.();
      }
    }, 250);
    return () => clearInterval(id);
    // remaining kasıtlı olarak bağımlılık dışında: yalnızca çalışma durumu değişince son değerden devam edilir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running]);

  return remaining;
}
