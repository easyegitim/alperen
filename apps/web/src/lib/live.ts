/**
 * Canlı izleme yardımcısı: bir iş bitene dek (öneriler, alıştırma seti, teşhis `solution_analyses`, `curricula`
 * taslak durumu) ekranı tazeler. Tek yerde iki yol:
 *
 *   - Supabase Realtime (barındırılan projede): verilen tablolara `postgres_changes` aboneliği; olay gelince hemen
 *     `check()`. Abonelik ayaktayken yoklama seyrek bir güvenlik nabzına (`heartbeatMs`, 15 sn) iner: yayına eklenmemiş
 *     tablo ya da kaçan olay ekranı takılı bırakmaz.
 *   - Yoklama (Realtime yoksa, bağlanamazsa ya da koparsa; yerel köprüde her zaman): `minMs` (2 sn) ile başlar, her turda
 *     `factor` (1,5) ile `maxMs`'e (5 sn) çekilir; toplam `maxElapsedMs` (120 sn) dolunca durur ve `onGiveUp` çağrılır.
 *
 * Sekme görünmezken (`document.visibilityState === 'hidden'`) yoklama durur; görünür olunca hemen bir kez bakılır ve
 * süre/geri çekilme sıfırlanır (öğrenci döndü, yeni bütçe). `check()` true dönerse izleme biter. Realtime
 * `NEXT_PUBLIC_SUPABASE_REALTIME=off` ile kapatılır; hata veren kanal kaldırılır (supabase-js yeniden bağlanma
 * döngüsü kalmaz) ve yoklamaya düşülür.
 *
 * Kullanım (istemci bileşeni):
 *   useLive({ key: `upload-${id}`, tables: [{ table: 'solution_analyses', event: 'INSERT' }], check: async () => {
 *     const s = await (await fetch(url, { cache: 'no-store' })).json(); if (s.done) { router.refresh(); return true; }
 *   }, onGiveUp: () => setSlow(true) });
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { createSupabaseBrowserClient } from './supabase/browser';

export interface LiveTable {
  table: string;
  /** PostgREST süzgeci, ör. `id=eq.<uuid>` (Realtime yalnız tek süzgeç alır). */
  filter?: string;
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*';
}

export interface LiveTiming {
  /** İlk yoklama aralığı (ms). */
  minMs: number;
  /** Geri çekilme tavanı (ms). */
  maxMs: number;
  /** Her turda aralık çarpanı. */
  factor: number;
  /** Toplam yoklama bütçesi (ms); dolunca durur. null: sınırsız. */
  maxElapsedMs: number | null;
  /** Realtime ayaktayken güvenlik yoklaması (ms). */
  heartbeatMs: number;
  /** İlk bakışa kadar bekleme (ms); varsayılan minMs. */
  initialDelayMs?: number;
}

export const LIVE_DEFAULTS: LiveTiming = { minMs: 2_000, maxMs: 5_000, factor: 1.5, maxElapsedMs: 120_000, heartbeatMs: 15_000 };

/** n. yoklamanın aralığı (0'dan): 2 sn → 3 sn → 4,5 sn → 5 sn … */
export function backoffDelay(attempt: number, t: Pick<LiveTiming, 'minMs' | 'maxMs' | 'factor'> = LIVE_DEFAULTS): number {
  return Math.min(t.maxMs, Math.round(t.minMs * Math.pow(t.factor, Math.max(0, attempt))));
}

export type LiveMode = 'polling' | 'realtime' | 'paused' | 'done' | 'gave_up';

/** Realtime kanalının izleyicinin gördüğü kadarı (testlerde sahtesi). */
export interface LiveChannel {
  close(): void;
}

export interface LiveEnv {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
  /** Sekme görünür mü. */
  visible(): boolean;
  /** Görünürlük değişimini dinler; dinlemeyi bırakan işlev döner. */
  onVisibility(fn: () => void): () => void;
  /** Realtime aboneliği; yoksa null (yalnız yoklama). `onState(true)` abone oldu, `false` koptu/hata. */
  subscribe: ((key: string, tables: readonly LiveTable[], onEvent: () => void, onState: (up: boolean) => void) => LiveChannel | null) | null;
}

export interface LiveOptions {
  key: string;
  check: () => Promise<boolean | void> | boolean | void;
  tables?: readonly LiveTable[];
  timing?: Partial<LiveTiming>;
  onGiveUp?: () => void;
  onMode?: (mode: LiveMode) => void;
}

/** Çerçeveden bağımsız çekirdek (useLive bunu sarar): durdurma işlevi döner. */
export function startLive(opts: LiveOptions, env: LiveEnv): () => void {
  const t: LiveTiming = { ...LIVE_DEFAULTS, ...opts.timing };
  let timer: unknown = null;
  let attempt = 0;
  let budgetStart = env.now();
  let realtimeUp = false;
  let finished = false;
  let running = false;
  let again = false;
  let mode: LiveMode | null = null;
  let channel: LiveChannel | null = null;
  let unlisten: () => void = () => undefined;
  const setMode = (m: LiveMode) => {
    if (m !== mode) {
      mode = m;
      opts.onMode?.(m);
    }
  };

  const clear = () => {
    if (timer !== null) env.clearTimeout(timer);
    timer = null;
  };

  const finish = (m: 'done' | 'gave_up') => {
    finished = true;
    clear();
    channel?.close();
    channel = null;
    unlisten();
    setMode(m);
    if (m === 'gave_up') opts.onGiveUp?.();
  };

  const schedule = (ms?: number) => {
    clear();
    if (finished) return;
    if (!env.visible()) {
      setMode('paused');
      return;
    }
    const elapsed = env.now() - budgetStart;
    if (t.maxElapsedMs !== null && elapsed >= t.maxElapsedMs) {
      finish('gave_up');
      return;
    }
    let delay = ms ?? (realtimeUp ? t.heartbeatMs : backoffDelay(attempt, t));
    if (t.maxElapsedMs !== null) delay = Math.min(delay, Math.max(0, t.maxElapsedMs - elapsed));
    setMode(realtimeUp ? 'realtime' : 'polling');
    timer = env.setTimeout(() => {
      timer = null;
      void run();
    }, delay);
  };

  const run = async () => {
    if (finished) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    let done = false;
    try {
      done = (await opts.check()) === true;
    } catch {
      // ağ kesintisi ya da geçici hata: bir sonraki turda yeniden
    } finally {
      running = false;
    }
    if (finished) return;
    if (done) {
      finish('done');
      return;
    }
    attempt++;
    if (again) {
      again = false;
      void run();
      return;
    }
    schedule();
  };

  if (env.subscribe && opts.tables && opts.tables.length > 0) {
    try {
      channel = env.subscribe(
        opts.key,
        opts.tables,
        () => void run(),
        (up) => {
          if (finished || up === realtimeUp) return;
          realtimeUp = up;
          if (!up) {
            // Kanal düştü: kaldır, yoklamaya dön (geri çekilme baştan)
            channel?.close();
            channel = null;
            attempt = 0;
          }
          schedule();
        },
      );
    } catch {
      channel = null;
    }
  }

  unlisten = env.onVisibility(() => {
    if (finished) return;
    if (env.visible()) {
      attempt = -1; // hemen bakılan tur sayılır; ardından aralık yine minMs'ten başlar
      budgetStart = env.now();
      void run();
    } else {
      clear();
      setMode('paused');
    }
  });

  schedule(t.initialDelayMs ?? t.minMs);

  return () => {
    if (finished) return;
    finished = true;
    clear();
    channel?.close();
    channel = null;
    unlisten();
  };
}

/** Realtime açık mı: `NEXT_PUBLIC_SUPABASE_REALTIME=off` kapatır (yerel köprü, Realtime'sız Supabase). */
export function realtimeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SUPABASE_REALTIME !== 'off' && Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
}

function browserSubscribe(key: string, tables: readonly LiveTable[], onEvent: () => void, onState: (up: boolean) => void): LiveChannel | null {
  const supabase = createSupabaseBrowserClient();
  let channel = supabase.channel(`live-${key}`);
  for (const tb of tables) {
    channel = channel.on(
      'postgres_changes' as never,
      { event: tb.event ?? '*', schema: 'public', table: tb.table, ...(tb.filter ? { filter: tb.filter } : {}) } as never,
      () => onEvent(),
    );
  }
  let closed = false;
  channel.subscribe((state: string) => {
    if (closed) return;
    if (state === 'SUBSCRIBED') onState(true);
    else if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') onState(false);
  });
  return {
    close() {
      if (closed) return;
      closed = true;
      void supabase.removeChannel(channel);
    },
  };
}

function browserEnv(): LiveEnv {
  return {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (h) => window.clearTimeout(h as number),
    now: () => Date.now(),
    visible: () => document.visibilityState !== 'hidden',
    onVisibility: (fn) => {
      document.addEventListener('visibilitychange', fn);
      return () => document.removeEventListener('visibilitychange', fn);
    },
    subscribe: realtimeEnabled() ? browserSubscribe : null,
  };
}

/**
 * İstemci kancası: `startLive`'ı bileşen ömrüne bağlar. `key` ya da `enabled` değişince yeniden kurulur; `check`,
 * `onGiveUp` ve tablolar her çizimde güncel tutulur (yeniden abone olmadan). Güncel kipi döner.
 */
export function useLive(opts: LiveOptions & { enabled?: boolean }): LiveMode | null {
  const ref = useRef(opts);
  // En güncel geri çağrılar etkiden okunur (yeniden abone olmadan); çizimden sonra eşlenir.
  useEffect(() => {
    ref.current = opts;
  });
  const [mode, setMode] = useState<LiveMode | null>(null);
  const enabled = opts.enabled !== false;
  const tablesKey = JSON.stringify(opts.tables ?? []);
  const timingKey = JSON.stringify(opts.timing ?? {});
  useEffect(() => {
    if (!enabled) return;
    const stop = startLive(
      {
        key: ref.current.key,
        tables: JSON.parse(tablesKey) as LiveTable[],
        timing: JSON.parse(timingKey) as Partial<LiveTiming>,
        check: () => ref.current.check(),
        onGiveUp: () => ref.current.onGiveUp?.(),
        onMode: (m) => {
          setMode(m);
          ref.current.onMode?.(m);
        },
      },
      browserEnv(),
    );
    return stop;
  }, [opts.key, enabled, tablesKey, timingKey]);
  return mode;
}
