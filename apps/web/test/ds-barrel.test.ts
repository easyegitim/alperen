import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as ds from '@ogrenmen/design-system';

// src/ds.ts, paketin ('use client' yönergesiz) dışa aktarımlarını istemci sınırı olarak yeniden dışa aktarır.
// Paket yeni bir bileşen/işlev eklerse bu test, listenin güncellenmesini ister.

const src = fs.readFileSync(path.resolve(__dirname, '../src/ds.ts'), 'utf8');

function listed(): string[] {
  const block = /export \{([\s\S]*?)\} from '@ogrenmen\/design-system';/.exec(src);
  return (block?.[1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('src/ds.ts', () => {
  it("'use client' ile başlar", () => {
    expect(src.trimStart().startsWith("'use client';")).toBe(true);
  });
  it('paketin tüm çalışma zamanı dışa aktarımlarını içerir ve fazlası yoktur', () => {
    expect([...listed()].sort()).toEqual(Object.keys(ds).sort());
  });
});
