import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { type Page } from '@playwright/test';
import pg from 'pg';
import { BRIDGE_URL, JOURNEY_OTP, JOURNEY_WEB_URL } from './config.mjs';

// P4–P6 yolculuk testlerinin ortak araçları (yolculuk yığını: stack.ts; OGRENMEN_LIVE=1). Gerçek Postgres'e sahip havuz,
// bekleme döngüsü, e-posta koduyla giriş, öğrenci kurulumu ve eğitmen/veli profili açma.

export const LIVE = process.env.OGRENMEN_LIVE === '1';
export const SHOTS = 'test-results/journey/screens';

let pool: pg.Pool | null = null;

export async function openPool(): Promise<void> {
  const info = (await (await fetch(`${BRIDGE_URL}/__info`)).json()) as { dbUrl: string };
  pool = new pg.Pool({ connectionString: info.dbUrl, max: 2 });
}
export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}
export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (!pool) throw new Error('havuz açık değil');
  return (await pool.query(sql, params)).rows as T[];
}

export async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 120_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`beklenen durum oluşmadı: ${what}`);
    await new Promise((r) => setTimeout(r, 750));
  }
}

/** pg-boss işi (ad + veri alanı) bitene kadar bekler; başarısız olursa hata. */
export async function jobDone(name: string, key: string, value: string, ms = 120_000): Promise<void> {
  await until(
    `${name} (${key}=${value}) tamamlandı`,
    async () => {
      const r = await q<{ state: string }>(`select state from pgboss.job where name = $1 and data ->> $2 = $3`, [name, key, value]);
      if (r.some((j) => j.state === 'failed')) throw new Error(`${name} başarısız`);
      return r.some((j) => j.state === 'completed');
    },
    ms,
  );
}

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/giris');
  await page.getByLabel('E-posta adresin').fill(email);
  await page.getByRole('button', { name: 'Kod gönder' }).click();
  await page.getByLabel('E-posta kodu').fill(JOURNEY_OTP);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
}

export interface NewStudent {
  student_id: string;
  profile_id: string;
  enrollment_id: string;
  course_id: string;
  email: string;
}

/** Yeni öğrenci: giriş + onboarding (TYT Matematik) → Bugün. */
export async function newStudent(page: Page, prefix: string): Promise<NewStudent> {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = `${prefix}-${Date.now()}@example.test`;
  await signIn(page, email);
  await page.waitForURL(/\/hos-geldin/);
  await page.getByRole('link', { name: 'Öğrenciyim' }).click();
  await page.getByLabel('Sınav veya ders ara').fill('TYT Matematik');
  await page.getByRole('button', { name: 'Devam' }).click();
  await page.getByLabel('Hedef tarih').fill(new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Bitir' }).click();
  await page.waitForURL(`${JOURNEY_WEB_URL}/ogrenci`);
  const [me] = await q<Omit<NewStudent, 'email'>>(
    `select s.id::text as student_id, s.profile_id::text, e.id::text as enrollment_id, e.course_id::text
       from auth.users u join public.students s on s.profile_id = u.id join public.enrollments e on e.student_id = s.id where u.email = $1`,
    [email],
  );
  if (!me?.course_id) throw new Error('öğrenci kaydının dersi yok');
  return { ...me, email };
}

/** Eğitmen: giriş yapar, profil rolü eğitmen olur (hesapları ekip açar; yolculukta doğrudan), öğrenciye ve derse bağlanır. */
export async function signInInstructor(page: Page, prefix: string, student: NewStudent): Promise<{ id: string; email: string }> {
  const email = `${prefix}-${Date.now()}@example.test`;
  await signIn(page, email);
  await page.waitForURL(/\/hos-geldin/);
  const [u] = await q<{ id: string }>(`select id::text from auth.users where email = $1`, [email]);
  await q(`insert into public.profiles (id, role, display_name, onboarded_at) values ($1, 'instructor', 'Deniz Hoca', now()) on conflict (id) do update set role = 'instructor', onboarded_at = now()`, [u!.id]);
  await q(`insert into public.instructor_links (instructor_id, student_id, course_id, role) values ($1, $2, $3, 'owner') on conflict do nothing`, [u!.id, student.student_id, student.course_id]);
  return { id: u!.id, email };
}

/** Oturum çerezinden erişim jetonu (RLS'li API çağrıları için). */
export async function accessToken(page: Page): Promise<string> {
  const cookies = (await page.context().cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name));
  cookies.sort((a, b) => Number(a.name.split('.').at(-1)) - Number(b.name.split('.').at(-1)));
  let raw = cookies.map((c) => decodeURIComponent(c.value)).join('');
  if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64url').toString('utf8');
  const tok = (JSON.parse(raw) as { access_token?: string }).access_token;
  if (!tok) throw new Error('oturum çerezi yok');
  return tok;
}

/** Sentetik çıkmış sınav PDF'i (matplotlib; 1 sayfa, "<yıl> final" yazar). */
export function syntheticPdf(year: number): Buffer {
  return execFileSync(
    'python3',
    [
      '-I',
      '-c',
      [
        'import io, sys, matplotlib',
        'matplotlib.use("Agg")',
        'import matplotlib.pyplot as plt',
        `f = plt.figure(figsize=(8.27, 11.69)); f.text(0.1, 0.9, "${year} final"); f.text(0.1, 0.8, "1) 3/4 - 1/2 : 2/3 = ?")`,
        'b = io.BytesIO(); f.savefig(b, format="pdf"); sys.stdout.buffer.write(b.getvalue())',
      ].join('\n'),
    ],
    { env: { ...process.env, MPLBACKEND: 'Agg' } },
  );
}

/** 10 sn'lik sentetik video (ffmpeg testsrc + sessiz değil sinüs sesi). */
export function syntheticVideo(seconds = 10): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogr-ders-'));
  const file = path.join(dir, 'ders.mp4');
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=320x240:rate=10:duration=${seconds}`, '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-c:a', 'aac', '-shortest', file],
  );
  return file;
}
