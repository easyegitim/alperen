import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { WorkerConfig } from '../src/config.js';
import type { Logger } from '../src/log.js';

// Açılış denetimi bağlantı açmadan, createApp içinde çalışır; bu yüzden veritabanı gerekmez.
const KEYS = ['NODE_ENV', 'OGRENMEN_LLM', 'LESSON_SERVICE_URL', 'LESSON_SERVICE_TOKEN'] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const silentLog = {} as unknown as Logger;

function restore(): void {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

describe('üretim yapılandırma denetimi (açılış)', () => {
  afterEach(restore);

  it('üretimde OGRENMEN_LLM=fake ile işçi açılmaz (OGR-LLM-012)', () => {
    process.env.NODE_ENV = 'production';
    process.env.OGRENMEN_LLM = 'fake';
    expect(() => createApp({} as unknown as WorkerConfig, { log: silentLog })).toThrow('OGR-LLM-012');
  });

  it('üretimde LESSON_SERVICE_URL varken belirteç boşsa açılmaz (OGR-JOB-185)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.OGRENMEN_LLM;
    process.env.LESSON_SERVICE_URL = 'http://ders:8711';
    process.env.LESSON_SERVICE_TOKEN = '  ';
    expect(() => createApp({} as unknown as WorkerConfig, { log: silentLog })).toThrow('OGR-JOB-185');
  });
});
