// @vitest-environment node
/**
 * src/lib/live.ts çekirdeği (startLive) sahte saat, görünürlük ve Realtime kanalıyla: geri çekilme 2 sn → 5 sn,
 * 120 sn bütçe, sekme gizliyken durma, görünür olunca hemen bakma, Realtime bağlıyken seyrek nabız, olayla anında bakış,
 * kopunca yoklamaya dönüş, check() true → bitiş.
 */
import { describe, expect, it } from 'vitest';
import { backoffDelay, LIVE_DEFAULTS, startLive, type LiveEnv, type LiveMode, type LiveTable } from '../src/lib/live';

function fakeEnv(opts: { realtime?: boolean } = {}) {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let visible = true;
  const visListeners = new Set<() => void>();
  const rt: { onEvent?: () => void; onState?: (up: boolean) => void; closed: boolean; tables?: readonly LiveTable[] } = { closed: false };
  const env: LiveEnv = {
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => void timers.delete(h as number),
    now: () => now,
    visible: () => visible,
    onVisibility: (fn) => {
      visListeners.add(fn);
      return () => visListeners.delete(fn);
    },
    subscribe: opts.realtime
      ? (_key, tables, onEvent, onState) => {
          Object.assign(rt, { onEvent, onState, tables });
          return { close: () => void (rt.closed = true) };
        }
      : null,
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  /** Saati ilerletir; sırası gelen zamanlayıcıları çalıştırır (her birinden sonra söz zinciri boşaltılır). */
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at;
      timers.delete(next[0]);
      next[1].fn();
      await flush();
    }
    now = end;
  };
  const setVisible = async (v: boolean) => {
    visible = v;
    for (const fn of visListeners) fn();
    await flush();
  };
  return { env, advance, setVisible, rt, pending: () => timers.size, listeners: () => visListeners.size };
}

describe('backoffDelay', () => {
  it('2 sn ile başlar, 1,5 kat büyür, 5 sn tavanda kalır', () => {
    expect([0, 1, 2, 3, 8].map((n) => backoffDelay(n))).toEqual([2_000, 3_000, 4_500, 5_000, 5_000]);
    expect(LIVE_DEFAULTS).toMatchObject({ minMs: 2_000, maxMs: 5_000, maxElapsedMs: 120_000 });
  });
});

describe('startLive', () => {
  it('yoklama: 2 → 3 → 4,5 → 5 sn aralıklarla bakar; 120 sn dolunca durur ve onGiveUp çağrılır', async () => {
    const f = fakeEnv();
    const at: number[] = [];
    let gaveUp = 0;
    const modes: LiveMode[] = [];
    startLive({ key: 'k', check: () => void at.push(f.env.now()), onGiveUp: () => gaveUp++, onMode: (m) => modes.push(m) }, f.env);
    await f.advance(15_000);
    expect(at).toEqual([2_000, 5_000, 9_500, 14_500]);
    await f.advance(120_000);
    expect(gaveUp).toBe(1);
    expect(at.at(-1)).toBeLessThanOrEqual(120_000);
    expect(modes).toEqual(['polling', 'gave_up']);
    expect(f.pending()).toBe(0);
    expect(f.listeners()).toBe(0);
  });

  it('check() true dönerse biter; hata fırlatan check bir sonraki turda yeniden denenir', async () => {
    const f = fakeEnv();
    let n = 0;
    const modes: LiveMode[] = [];
    startLive(
      {
        key: 'k',
        check: () => {
          n++;
          if (n === 1) throw new Error('ağ');
          return n === 3;
        },
        onMode: (m) => modes.push(m),
      },
      f.env,
    );
    await f.advance(30_000);
    expect(n).toBe(3);
    expect(modes.at(-1)).toBe('done');
    expect(f.pending()).toBe(0);
  });

  it('sekme gizliyken yoklamaz; görünür olunca hemen bakar ve bütçe/aralık sıfırlanır', async () => {
    const f = fakeEnv();
    let n = 0;
    startLive({ key: 'k', check: () => void n++ }, f.env);
    await f.advance(2_000);
    expect(n).toBe(1);
    await f.setVisible(false);
    await f.advance(300_000);
    expect(n).toBe(1);
    await f.setVisible(true);
    expect(n).toBe(2);
    await f.advance(2_000);
    expect(n).toBe(3);
  });

  it('Realtime: bağlıyken yalnız 15 sn nabız, olay gelince hemen bakar; koparsa kanal kapanır ve 2 sn yoklamaya döner', async () => {
    const f = fakeEnv({ realtime: true });
    let n = 0;
    const modes: LiveMode[] = [];
    const stop = startLive({ key: 'k', tables: [{ table: 'curricula', filter: 'id=eq.c1', event: 'UPDATE' }], check: () => void n++, onMode: (m) => modes.push(m) }, f.env);
    expect(f.rt.tables).toEqual([{ table: 'curricula', filter: 'id=eq.c1', event: 'UPDATE' }]);
    f.rt.onState!(true);
    await f.advance(10_000);
    expect(n).toBe(0);
    f.rt.onEvent!();
    await new Promise((r) => setTimeout(r, 0));
    expect(n).toBe(1);
    await f.advance(15_000);
    expect(n).toBe(2);
    expect(modes).toContain('realtime');
    f.rt.onState!(false);
    expect(f.rt.closed).toBe(true);
    await f.advance(2_000);
    expect(n).toBe(3);
    expect(modes.at(-1)).toBe('polling');
    stop();
    await f.advance(60_000);
    expect(n).toBe(3);
  });

  it('tablo verilmezse ya da Realtime kapalıysa abone olmaz', async () => {
    const f = fakeEnv({ realtime: true });
    startLive({ key: 'k', check: () => undefined }, f.env);
    expect(f.rt.onState).toBeUndefined();
  });
});
