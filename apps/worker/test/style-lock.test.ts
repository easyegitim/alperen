// Ders başına tarz kütüphanesi kilidi (styles/lock.ts): kilit bağlantıda alınır, iş bitince açılır, bağlantı bırakılır;
// bağlantı vermeyen sahte veritabanında iş kilitsiz ama değişmeden çalışır.
import { describe, expect, it } from 'vitest';
import { courseLockKey, withCourseLibraryLock, type LockClient } from '../src/styles/lock.js';

function fakeDb() {
  const calls: string[] = [];
  const released: unknown[] = [];
  let connects = 0;
  const client: LockClient = {
    query: async (text: string, values?: unknown[]) => {
      calls.push(`${text.includes('unlock') ? 'unlock' : text.includes('pg_advisory_lock') ? 'lock' : 'other'}:${String(values?.[0])}`);
      return { rows: [] };
    },
    release: (err) => {
      released.push(err ?? false);
    },
  };
  const db = {
    query: async () => ({ rows: [] }),
    connect: async () => {
      connects++;
      return client;
    },
  };
  return { db, calls, released, connects: () => connects };
}

describe('withCourseLibraryLock', () => {
  it('kilidi ayrılmış bağlantıda alır, işi çalıştırır, açar ve bağlantıyı bırakır', async () => {
    const f = fakeDb();
    const out = await withCourseLibraryLock(f.db, 'c1', async () => 42);
    expect(out).toBe(42);
    expect(f.calls).toEqual([`lock:${courseLockKey('c1')}`, `unlock:${courseLockKey('c1')}`]);
    expect(f.released).toEqual([false]);
  });

  it('iş hata verse de kilit açılır ve hata yukarı taşınır', async () => {
    const f = fakeDb();
    await expect(withCourseLibraryLock(f.db, 'c2', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(f.calls.at(-1)).toBe(`unlock:${courseLockKey('c2')}`);
    expect(f.released).toHaveLength(1);
  });

  it('bağlantı vermeyen veritabanında iş kilitsiz çalışır', async () => {
    let ran = false;
    const out = await withCourseLibraryLock({ query: async () => ({ rows: [] }) }, 'c3', async () => {
      ran = true;
      return 'ok';
    });
    expect(ran).toBe(true);
    expect(out).toBe('ok');
  });

  it('farklı dersler farklı kilit anahtarı alır', () => {
    expect(courseLockKey('a')).not.toBe(courseLockKey('b'));
  });
});
