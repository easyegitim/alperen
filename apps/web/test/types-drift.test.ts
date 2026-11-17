import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// src/lib/supabase/types.ts elle yazılır; bu test, Row alanlarının gerçekten göç dosyalarındaki sütunlar olduğunu
// denetler (yazım hatası ya da sütun yeniden adlandırması sessiz kalmasın).

const ROOT = path.resolve(__dirname, '../../..');
const MIGRATIONS = path.join(ROOT, 'supabase/migrations');
const TYPES_SRC = fs.readFileSync(path.resolve(__dirname, '../src/lib/supabase/types.ts'), 'utf8');

function migrationSql(): string {
  return fs
    .readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'))
    .join('\n');
}

/** tablo -> sütun adları (create table gövdesi + alter table ... add column). */
function columnsByTable(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const createRe = /create table (?:if not exists )?public\.(\w+) \(([\s\S]*?)\n\);/g;
  for (const m of sql.matchAll(createRe)) {
    const cols = new Set<string>();
    for (const line of (m[2] ?? '').split('\n')) {
      const c = /^\s{2}(\w+)\s+(?!\()[a-z]/.exec(line);
      if (c?.[1] && !['primary', 'unique', 'check', 'constraint', 'foreign'].includes(c[1])) cols.add(c[1]);
    }
    tables.set(m[1] as string, cols);
  }
  for (const m of sql.matchAll(/alter table public\.(\w+) add column (?:if not exists )?(\w+)/g)) tables.get(m[1] as string)?.add(m[2] as string);
  return tables;
}

/** types.ts içindeki `export type XRow = { ... };` blokları: Row adı -> alan adları. */
function typeRows(): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const m of TYPES_SRC.matchAll(/export type (\w+)Row = \{([\s\S]*?)\n\};/g)) {
    rows.set(m[1] as string, [...(m[2] as string).matchAll(/^\s{2}(\w+)\??:/gm)].map((f) => f[1] as string));
  }
  return rows;
}

const TABLE_FOR_ROW: Record<string, string> = {
  Profile: 'profiles',
  Student: 'students',
  GuardianLink: 'guardian_links',
  InstructorLink: 'instructor_links',
  Course: 'courses',
  Enrollment: 'enrollments',
  Preference: 'preferences',
  Conversation: 'conversations',
  MemoryFile: 'memory_files',
  Notification: 'notifications',
  NotificationRule: 'notification_rules',
  PushSubscription: 'push_subscriptions',
};

describe('Supabase tipleri göç dosyalarıyla uyumlu', () => {
  const tables = columnsByTable(migrationSql());
  const rows = typeRows();

  it('tüm Row tipleri bilinen bir tabloya eşlenir', () => {
    expect([...rows.keys()].sort()).toEqual(Object.keys(TABLE_FOR_ROW).sort());
  });

  for (const [rowName, table] of Object.entries(TABLE_FOR_ROW)) {
    it(`${table}: Row alanları = göçlerdeki sütunlar`, () => {
      const cols = tables.get(table);
      expect(cols, `${table} göçlerde bulunamadı`).toBeDefined();
      const fields = rows.get(rowName) ?? [];
      expect([...fields].sort()).toEqual([...(cols ?? [])].sort());
    });
  }

  it('RPC adları göçlerde tanımlı', () => {
    const sql = migrationSql();
    for (const fn of ['accept_guardian_invite', 'create_guardian_invite', 'revoke_guardian_link']) {
      expect(sql).toMatch(new RegExp(`create or replace function public\\.${fn}\\(`));
    }
  });
});
