import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { DEAD_LETTER_QUEUE, JOBS, getJob, jobNames, jobsForProcess, validateRegistry } from '../src/jobs/registry.js';
import { SCHEDULES } from '../src/schedules.js';

describe('iş kayıt defteri', () => {
  it('beklenen iş adlarını kaydeder', () => {
    for (const n of ['noop', 'llm.ping', 'memory.compact', 'dossier.render', 'pdf.render', 'push.send', 'weekly.summary', 'suggestions.refresh', 'activity.completed', 'conversation.summarize', 'diagnosis.followup']) {
      expect(getJob(n), n).toBeDefined();
    }
  });

  it('tutarlı: yinelenen ad yok, politikalar geçerli', () => {
    expect(validateRegistry()).toEqual([]);
    expect(new Set(jobNames()).size).toBe(JOBS.length);
    expect(jobNames()).not.toContain(DEAD_LETTER_QUEUE);
  });

  it('validateRegistry kötü tanımları yakalar', () => {
    const bad = { ...getJob('noop')!, name: 'Kötü Ad', retry: { retryLimit: 0, retryDelay: 0, retryBackoff: true, expireInSeconds: 60 } };
    expect(validateRegistry([bad, bad]).length).toBeGreaterThanOrEqual(3);
  });

  it('pdf.render yalnız pdf sürecinde, diğerleri worker sürecinde çalışır', () => {
    const pdf = jobsForProcess('pdf').map((j) => j.name);
    expect(pdf).toEqual(['pdf.render']);
    expect(jobsForProcess('worker').map((j) => j.name)).not.toContain('pdf.render');
    expect(jobsForProcess('all')).toHaveLength(JOBS.length);
  });

  it('işleyicisi olmayan SQL iş adları da kuyruk olarak kayıtlıdır', () => {
    for (const n of ['exam.report', 'document.generate', 'practice.generate', 'memory.correction']) expect(getJob(n)?.handler).toBeNull();
  });

  it('yük şemaları geçersiz yükü reddeder', () => {
    expect(getJob('dossier.render')!.payload.safeParse({ student_id: 'x' }).success).toBe(false);
    const id = '00000000-0000-0000-0000-000000000001';
    expect(getJob('dossier.render')!.payload.safeParse({ student_id: id, course_id: id }).success).toBe(true);
    expect(getJob('dossier.render')!.payload.safeParse({ studentId: id, courseId: id }).success).toBe(true);
    expect(getJob('pdf.render')!.payload.safeParse({ output: { path: 'a.pdf' } }).success).toBe(false);
    expect(getJob('pdf.render')!.payload.safeParse({ html: '<p>x</p>', output: { path: 'a.pdf' } }).success).toBe(true);
    expect(getJob('noop')!.payload.safeParse({}).success).toBe(true);
  });

  it('zamanlamalar kayıtlı işleri gösterir (03:00 gece, pazar 19:00)', () => {
    expect(SCHEDULES.map((s) => [s.job, s.cron])).toEqual([
      ['memory.compact', '0 3 * * *'],
      ['weekly.summary', '0 19 * * 0'],
    ]);
    for (const s of SCHEDULES) expect(getJob(s.job)).toBeDefined();
  });
});

describe('yapılandırma', () => {
  it('DATABASE_URL zorunlu; varsayılanlar', () => {
    expect(() => loadConfig({}, [])).toThrow(/DATABASE_URL/);
    const c = loadConfig({ DATABASE_URL: 'postgresql://u:p@h:5432/d' }, []);
    expect(c.bossSchema).toBe('pgboss');
    expect(c.process).toBe('all');
    expect(c.vapid).toBeNull();
  });

  it('--process bayrağı ve VAPID üçlüsü', () => {
    expect(loadConfig({ DATABASE_URL: 'x://y' }, ['--process=pdf']).process).toBe('pdf');
    expect(() => loadConfig({ DATABASE_URL: 'x://y', VAPID_PUBLIC_KEY: 'a' }, [])).toThrow(/VAPID/);
    expect(() => loadConfig({ DATABASE_URL: 'x://y', PGBOSS_SCHEMA: 'a;drop' }, [])).toThrow(/PGBOSS_SCHEMA/);
  });

  it('bekleyen kuyruklar RPC yüklerini (snake_case) doğrular', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(getJob('diagnosis.followup')!.payload.safeParse({ analysis_id: id, enrollment_id: id }).success).toBe(true);
    expect(getJob('diagnosis.followup')!.payload.safeParse({ analysisId: id }).success).toBe(false);
    expect(getJob('suggestions.refresh')!.payload.safeParse({ student_id: id, enrollment_id: id, reason: 'practice.finished', set_id: id }).success).toBe(true);
    expect(getJob('suggestions.refresh')!.payload.safeParse({}).success).toBe(true);
    expect(getJob('suggestions.refresh')!.payload.safeParse({ student_id: 'x' }).success).toBe(false);
    expect(getJob('practice.generate')!.payload.safeParse({ set_id: id, enrollment_id: id, curriculum_id: id, skill_ids: ['a'], count: 8 }).success).toBe(true);
    expect(getJob('memory.correction')!.payload.safeParse({ correction_id: id, student_id: id, path: '/memories/profile.md' }).success).toBe(true);
    expect(getJob('exam.report')!.payload.safeParse({ session_id: id }).success).toBe(true);
    expect(getJob('document.generate')!.payload.safeParse({ document_id: id, kind: 'rapor' }).success).toBe(true);
    expect(getJob('document.generate')!.payload.safeParse({ document_id: 'x', kind: 'rapor' }).success).toBe(false);
    expect(getJob('curriculum.merge')!.payload.safeParse({ proposal_id: id }).success).toBe(true);
    expect(getJob('curriculum.merge')!.payload.safeParse({}).success).toBe(false);
  });

  it('PGBOSS_SCHEMA üretimde yalnız pgboss olabilir', () => {
    const base = { DATABASE_URL: 'postgresql://x@127.0.0.1/db' };
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', PGBOSS_SCHEMA: 'baska' }, [])).toThrow(/pgboss/);
    expect(loadConfig({ ...base, NODE_ENV: 'production' }, []).bossSchema).toBe('pgboss');
    expect(loadConfig({ ...base, PGBOSS_SCHEMA: 'pgboss_t_ab' }, []).bossSchema).toBe('pgboss_t_ab');
  });

  it('pg_cron zamanlamaları (0016_cron.sql) kayıtlı iş adlarıyla örtüşür (drift denetimi)', () => {
    const sql = readFileSync(new URL('../../../supabase/migrations/0016_cron.sql', import.meta.url), 'utf8');
    const names = [...sql.matchAll(/cron\.schedule\([\s\S]*?enqueue_job\('([^']+)'/g)].map((m) => m[1]!);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(jobNames(), n).toContain(n);
    // Plan §10: pazar 19:00 TRT = 16:00 UTC.
    expect(sql).toContain("'0 16 * * 0'");
  });
});
