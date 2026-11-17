import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import { BRIDGE_URL, JOURNEY_OTP, JOURNEY_WEB_URL } from './journey/config.mjs';
import { hasHorizontalOverflow } from './helpers';

// P3 içerik stüdyosu yolculuğu uçtan uca (OGRENMEN_LIVE=1; playwright.journey.config.ts): gerçek Postgres + Supabase uyumlu
// köprü + gerçek worker (pg-boss, doc-render PDF, yerel matplotlib figürü) + `next dev`; LLM her yerde sahte.
//   Koç'ta "rasyonel sayılar için not hazırla" → document.generate → Bugün "notun hazır" → PDF görüntüleyici →
//   "10 soruluk deneme hazırla" → mock_exam → "Çöz" → uygulama içi sınav → bitir.

const LIVE = process.env.OGRENMEN_LIVE === '1';
const SHOTS = 'test-results/journey/screens';

let pool: pg.Pool;

test.beforeAll(async () => {
  if (!LIVE) return;
  const info = (await (await fetch(`${BRIDGE_URL}/__info`)).json()) as { dbUrl: string };
  pool = new pg.Pool({ connectionString: info.dbUrl, max: 2 });
});
test.afterAll(async () => {
  await pool?.end();
});

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 120_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`beklenen durum oluşmadı: ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function accessToken(page: Page): Promise<string> {
  const cookies = (await page.context().cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name));
  cookies.sort((a, b) => Number(a.name.split('.').at(-1)) - Number(b.name.split('.').at(-1)));
  let raw = cookies.map((c) => decodeURIComponent(c.value)).join('');
  if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64url').toString('utf8');
  const tok = (JSON.parse(raw) as { access_token?: string }).access_token;
  if (!tok) throw new Error('oturum çerezi yok');
  return tok;
}

async function newStudent(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = `icerik-${Date.now()}@example.test`;
  await page.goto('/giris');
  await page.getByLabel('E-posta adresin').fill(email);
  await page.getByRole('button', { name: 'Kod gönder' }).click();
  await page.getByLabel('E-posta kodu').fill(JOURNEY_OTP);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await page.waitForURL(/\/hos-geldin/);
  await page.getByRole('link', { name: 'Öğrenciyim' }).click();
  await page.getByLabel('Sınav veya ders ara').fill('TYT Matematik');
  await page.getByRole('button', { name: 'Devam' }).click();
  await page.getByLabel('Hedef tarih').fill(new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10));
  await page.getByRole('button', { name: 'Bitir' }).click();
  await page.waitForURL(`${JOURNEY_WEB_URL}/ogrenci`);
  const [me] = await q<{ student_id: string; profile_id: string }>(
    `select s.id::text as student_id, s.profile_id::text from auth.users u join public.students s on s.profile_id = u.id where u.email = $1`,
    [email],
  );
  return me!;
}

async function ask(page: Page, text: string) {
  await page.goto('/ogrenci/koc');
  await expect(page.getByRole('heading', { level: 1, name: 'Koç' })).toBeVisible();
  await page.getByLabel('Koça yaz').fill(text);
  await page.getByRole('button', { name: 'Gönder' }).click();
  await expect(page.getByRole('log', { name: 'Öğrenmen ile sohbet' }).getByText(/Hazır olunca Bugün/)).toBeVisible();
}

/** Belgenin PDF'i: öğrencinin kendi jetonuyla Storage'dan indirilir (RLS/Storage politikası gerçek); metni pdftotext'ten. */
async function pdfText(page: Page, pdfPath: string): Promise<{ bytes: number; text: string }> {
  const token = await accessToken(page);
  const res = await fetch(`${BRIDGE_URL}/storage/v1/object/documents/${pdfPath}`, { headers: { authorization: `Bearer ${token}` } });
  expect(res.status).toBe(200);
  const buf = Buffer.from(await res.arrayBuffer());
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ogr-pdf-'));
  try {
    const file = path.join(dir, 'belge.pdf');
    fs.writeFileSync(file, buf);
    const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
    return { bytes: buf.length, text };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test.describe('P3 içerik yolculuğu (gerçek Postgres + worker)', () => {
  test.skip(!LIVE, 'OGRENMEN_LIVE=1 gerekir (yerel Postgres)');

  test('Koç: not iste → notun hazır → PDF; deneme iste → Çöz → sınav → bitir', async ({ page }) => {
    const me = await newStudent(page);

    // Öğrencinin hafızasındaki örüntü (Koç/teşhis hattı yazar; burada doğrudan): not "Senin sık yaptığın hata" kutusu taşır.
    // Sahte not fikstürü patterns.md:2 satırına (12 ve 19 Ekim) bağlanır; satır numarası dosyadaki satırdır.
    await q(
      `insert into public.memory_files (student_id, path, content) values ($1, '/memories/patterns.md', $2)
       on conflict (student_id, path) do update set content = excluded.content`,
      [me.student_id, "# Örüntüler\n- 12 ve 19 Ekim'de paydaları da toplayarak kesir topladı.\n"],
    );

    // --- Not: Koç → document.generate (sahte LLM + yerel figür) → yayımlandı
    await ask(page, 'rasyonel sayılar için not hazırla');
    const doc = await until('notes belgesi yayımlandı', async () => {
      const r = await q<{ id: string; status: string; pdf_path: string | null; review_required: boolean }>(
        `select id::text, status, pdf_path, review_required from public.generated_documents where student_id = $1 and kind = 'notes'`,
        [me.student_id],
      );
      if (r[0]?.status === 'failed') throw new Error('not üretimi başarısız');
      return r[0]?.status === 'published' && r[0].pdf_path ? r[0] : null;
    });
    expect(doc.review_required).toBe(false);
    const job = await q<{ state: string }>(`select state from pgboss.job where name = 'document.generate' and data ->> 'document_id' = $1`, [doc.id]);
    expect(job.map((j) => j.state)).toContain('completed');

    // Bugün: document_ready kartı "… notun hazır · PDF"
    await page.goto('/ogrenci');
    const notice = page.getByRole('button', { name: /Aç: .*notun hazır/ });
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('PDF');
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/p3-01-bugun-not-hazir.png`, fullPage: true });

    // Belge sayfası: PDF görüntüleyici (canvas), Storage'daki PDF > 1000 bayt, metin: sık yapılan hata callout'u var, anahtar yok
    await notice.click();
    await page.waitForURL(/\/ogrenci\/belge\/[0-9a-f-]{36}$/);
    const viewer = page.getByTestId('belge-goruntuleyici');
    await expect(viewer.locator('canvas').first()).toBeVisible({ timeout: 45_000 });
    expect(await viewer.locator('canvas').count()).toBeGreaterThan(0);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/p3-02-not-pdf.png` });
    const pdf = await pdfText(page, doc.pdf_path!);
    expect(pdf.bytes).toBeGreaterThan(1000);
    expect(pdf.text).toContain('Senin sık yaptığın hata');
    expect(pdf.text).not.toMatch(/Cevap anahtarı/i);
    // Figür: yerel matplotlib (sahte LLM) SVG'si AST'ye gömüldü, PDF'te çizildi
    const [ast] = await q<{ svgs: number }>(`select (length(content::text) - length(replace(content::text, '<svg', ''))) / 4 as svgs from public.generated_documents where id = $1`, [doc.id]);
    expect(ast!.svgs).toBeGreaterThan(0);
    expect(pdf.text).toContain('Toplam: 8 + 3 = 11 parça');

    // --- Deneme: Koç → mock_exam → Çöz → uygulama içi sınav → bitir
    await ask(page, '10 soruluk deneme hazırla');
    const exam = await until('mock_exam belgesi', async () => {
      const r = await q<{ id: string; status: string; exam_id: string | null; pdf_path: string | null }>(
        `select gd.id::text, gd.status, e.id::text as exam_id, gd.pdf_path
           from public.generated_documents gd left join public.exams e on e.generated_document_id = gd.id
          where gd.student_id = $1 and gd.kind = 'mock_exam'`,
        [me.student_id],
      );
      if (r[0]?.status === 'failed') throw new Error('deneme üretimi başarısız');
      return r[0]?.status === 'published' && r[0].exam_id ? r[0] : null;
    });
    const examPdf = await pdfText(page, exam.pdf_path!);
    expect(examPdf.bytes).toBeGreaterThan(1000);
    expect(examPdf.text).not.toMatch(/Cevap anahtarı/i);

    await page.goto('/ogrenci');
    await page.getByRole('button', { name: /Aç: Denemen hazır/ }).click();
    await page.waitForURL(/\/ogrenci\/belge\/[0-9a-f-]{36}$/);
    await page.screenshot({ path: `${SHOTS}/p3-03-deneme-belge.png` });
    await page.getByRole('link', { name: 'Çöz' }).click();
    await page.waitForURL(new RegExp(`/ogrenci/sinav/${exam.exam_id}$`));
    await page.getByRole('button', { name: 'Başla' }).click();
    await page.waitForURL(/\/ogrenci\/sinav\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('timer', { name: 'Kalan süre' })).toBeVisible();
    const total = (await q<{ n: number }>(`select count(*)::int as n from public.exam_questions where exam_id = $1`, [exam.exam_id]))[0]!.n;
    expect(total).toBeGreaterThanOrEqual(2);
    for (let i = 1; i <= total; i++) {
      await expect(page.getByTestId('soru-no')).toHaveText(`Soru ${i} / ${total}`);
      const radios = page.getByRole('radio');
      if ((await radios.count()) > 0) await radios.first().click();
      else await page.getByLabel(/Cevap/).first().fill('1');
      if (i < total) await page.getByRole('button', { name: 'Sonraki' }).click();
    }
    await page.screenshot({ path: `${SHOTS}/p3-04-sinav-soru.png` });
    await page.getByRole('button', { name: 'Bitir' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Bitir' }).click();
    await expect(page.getByTestId('tek-cumle')).toBeVisible({ timeout: 60_000 });
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/p3-05-sinav-sonuc.png`, fullPage: true });
    const sess = await q<{ status: string }>(`select status from public.exam_sessions where exam_id = $1`, [exam.exam_id]);
    expect(sess[0]!.status).toBe('done');
  });
});
