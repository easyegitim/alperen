/**
 * Açılışta prompt sürümlerinin eşlendiğini doğrular (syncPromptVersions çağrılır). Geçici pg-boss şeması kurar ve siler.
 * OGRENMEN_LIVE=1 yoksa atlanır.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { silentLogger } from '../src/log.js';
import { routedDb } from './support.js';

const url = process.env.DATABASE_URL ?? process.env.OGRENMEN_DATABASE_URL ?? 'postgresql://ogrenmen:ogrenmen@127.0.0.1:5432/ogrenmen';
const live = process.env.OGRENMEN_LIVE === '1';
const schema = `pgboss_t_${randomBytes(4).toString('hex')}`;

describe.skipIf(!live)('açılışta prompt eşlemesi', () => {
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  afterAll(async () => {
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  });

  it('start() prompt_versions yazar', async () => {
    const db = Object.assign(routedDb([[/insert into public\.prompt_versions/, () => [{ id: 1 }]]]), { end: async () => undefined });
    const config = loadConfig({ DATABASE_URL: url, PGBOSS_SCHEMA: schema, HEALTH_HOST: '127.0.0.1', HEALTH_PORT: '0', WORKER_SCHEDULES: 'off' }, ['--process=all']);
    const app = createApp(config, { log: silentLogger, db, pdf: { render: async () => ({ pdf: Buffer.from('%PDF-1.4'), pages: 1, bytes: 8 }), close: async () => undefined } });
    await app.start();
    try {
      expect(db.calls.some((c) => /insert into public\.prompt_versions/.test(c.text))).toBe(true);
    } finally {
      await app.stop();
    }
  });
});
