import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import sharp from 'sharp';
import { BRIDGE_URL, JOURNEY_OTP, JOURNEY_WEB_URL } from './journey/config.mjs';
import { hasHorizontalOverflow } from './helpers';

// P2 deneme yolculuğu uçtan uca (OGRENMEN_LIVE=1; playwright.journey.config.ts): gerçek Postgres + Supabase uyumlu köprü
// + gerçek worker (pg-boss, doc-render PDF) + `next dev`; LLM her yerde sahte (OGRENMEN_LLM=fake). Fikstürler
// sayfa sırasına bağlıdır ("sayfa 1/3."): sentetik deneme fixtures/exams/synthetic (kitapçık 1–2 + optik form).
//   1. Okul denemesi: Yükle → 3 görsel → bekleme → tek cümle sonuç → Detay → "Nereye kadar geldim?" → teşhis → rapor PDF.
//   2. Uygulama içi deneme: mini_exam önerisi → 3 soru → Bitir → sonuç (exam.report).

const LIVE = process.env.OGRENMEN_LIVE === '1';
const SHOTS = 'test-results/journey/screens';
const SYN = new URL('../../../fixtures/exams/synthetic/', import.meta.url);

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

async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 90_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`beklenen durum oluşmadı: ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/** Giriş + onboarding (TYT Matematik, hedef tarihli); öğrenci/kayıt kimliklerini döner. */
async function newStudent(page: Page, prefix: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  const email = `${prefix}-${Date.now()}@example.test`;
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
  const [me] = await q<{ student_id: string; enrollment_id: string; curriculum_id: string; profile_id: string }>(
    `select s.id::text as student_id, e.id::text as enrollment_id, e.curriculum_id::text, s.profile_id::text
       from auth.users u join public.students s on s.profile_id = u.id join public.enrollments e on e.student_id = s.id where u.email = $1`,
    [email],
  );
  return me!;
}

test.describe('P2 deneme yolculuğu (gerçek Postgres + worker)', () => {
  test.skip(!LIVE, 'OGRENMEN_LIVE=1 gerekir (yerel Postgres)');

  test('Okul denemesi: yükle → bekleme → tek cümle → Detay → Nereye kadar geldim? → teşhis → rapor PDF', async ({ page }) => {
    const me = await newStudent(page, 'deneme');

    await page.goto('/ogrenci/yukle');
    await page.getByText('Okul denemesi', { exact: true }).click();
    const files = await Promise.all(
      ['booklet-p1.png', 'booklet-p2.png', 'answer-sheet.png'].map(async (name) => ({
        name,
        mimeType: 'image/png',
        buffer: await sharp(new URL(name, SYN).pathname).png().toBuffer(),
      })),
    );
    await page.getByTestId('kamera-girisi').setInputFiles(files);
    await expect(page.getByText('3 sayfa hazır')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/p2-01-yukle.png`, fullPage: true });
    await page.getByRole('button', { name: 'Gönder' }).click();

    // bekleme (progress: sayfa n/3)
    await page.waitForURL(/\/ogrenci\/deneme\/[0-9a-f-]{36}$/);
    const sessionId = page.url().split('/').at(-1)!;
    // (sahte hat saniyeler sürer; bekleme ekranı ya da sonuç görünür. Bekleme satırı sayfa sayısıyla sınanır: deneme-sonuc.spec)
    await expect(page.getByTestId('bekleme-satiri').or(page.getByTestId('tek-cumle'))).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // sonuç: büyük net + tek cümle, tek birincil "Devam et", detay katlı, yüzde yok
    const sentence = page.getByTestId('tek-cumle');
    await expect(sentence).toBeVisible({ timeout: 120_000 });
    expect((await sentence.innerText()).trim()).toMatch(/^[^!%]+\.$/);
    await expect(page.getByTestId('buyuk-sayi')).toContainText('net');
    await expect(page.getByRole('link', { name: 'Devam et' })).toHaveCount(1);
    await expect(page.getByTestId('detay')).toBeHidden();
    await expect(page.getByText('%')).toHaveCount(0);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/p2-02-sonuc.png`, fullPage: true });

    // veritabanı: oturum bitti, 10 soru, net 5,5; worker işi tamam
    const [ses] = await q<{ status: string; questions: number; net: string | null }>(
      `select es.status, (select count(*)::int from public.exam_questions eq where eq.exam_id = es.exam_id) as questions,
              (es.score ->> 'net') as net
         from public.exam_sessions es where es.id = $1`,
      [sessionId],
    );
    expect(ses).toMatchObject({ status: 'done', questions: 10 });
    expect(Number(ses!.net)).toBeCloseTo(5.5, 5);

    // Detay: yanlış/boş listesi; yanlış soru → "Nereye kadar geldim?"
    await page.getByRole('button', { name: 'Detay' }).click();
    await expect(page.getByTestId('detay')).toBeVisible();
    await expect(page.getByTestId('bolum-netleri')).toBeVisible();
    await expect(page.getByTestId('isi-haritasi')).toBeVisible();
    const rows = page.getByTestId('yanlis-bos').getByRole('listitem');
    await expect(rows).toHaveCount(4); // yanlış 4 ve 9, boş 5 ve 7
    await page.screenshot({ path: `${SHOTS}/p2-03-detay.png`, fullPage: true });
    await rows.filter({ hasText: 'Soru 4' }).getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Soru 4' })).toBeVisible();
    await page.getByRole('button', { name: 'Yaz' }).click();
    await page.getByLabel('Nereye kadar geldin?').fill('Üslü ifadeyi açarken 3 üssü 3 değerini yanlış hesapladım.');
    await page.getByRole('button', { name: 'Gönder' }).click();
    await page.waitForURL(/\/ogrenci\/deneme\/[0-9a-f-]{36}\?detay=1$/);

    // worker: diagnosis.run (deneme bağlamı, sahte solution_diagnosis) → solution_analyses; satır "Teşhisi gör"
    await until('deneme teşhisi', async () => (await q(`select 1 from public.solution_analyses sa where sa.enrollment_id = $1 and sa.created_at > now() - interval '10 minutes'`, [me.enrollment_id])).length > 0);
    await expect(page.getByTestId('yanlis-bos').getByRole('link', { name: /Teşhisi gör/ })).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('yanlis-bos').getByRole('link', { name: /Teşhisi gör/ }).first().click();
    // satır → soru ekranı (tek cümle teşhis) → "Teşhisi gör" → teşhis ekranı
    await page.waitForURL(/\/ogrenci\/deneme\/[0-9a-f-]{36}\/soru\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('nereye-durum')).not.toContainText('Bakıyorum');
    await page.getByRole('link', { name: 'Teşhisi gör' }).click();
    await page.waitForURL(/\/ogrenci\/teshis\/[0-9a-f-]{36}\?don=/);
    await page.screenshot({ path: `${SHOTS}/p2-04-teshis.png`, fullPage: true });
    await page.goBack();

    // rapor PDF görüntüleyici (S09): gerçek doc-render PDF'i, sayfa sayısı > 0
    const [doc] = await until('rapor belgesi', async () => {
      const r = await q<{ id: string; pdf_path: string }>(`select id::text, pdf_path from public.generated_documents where student_id = $1 and kind = 'report' and pdf_path is not null`, [me.student_id]);
      return r.length ? r : null;
    });
    const pdf = await q<{ size: number }>(`select (o.metadata ->> 'size')::int as size from storage.objects o where o.bucket_id = 'documents' and o.name = $1`, [doc!.pdf_path]);
    expect(pdf).toHaveLength(1);
    expect(pdf[0]!.size).toBeGreaterThan(1000);
    await page.goto('/ogrenci/gelisim/belgeler');
    await page.getByRole('link', { name: /analizi · Rapor/ }).first().click();
    await page.waitForURL(/\/ogrenci\/belge\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: /analizi/ })).toBeVisible();
    const viewer = page.getByTestId('belge-goruntuleyici');
    await expect(viewer.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
    expect(await viewer.locator('canvas').count()).toBeGreaterThan(0);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/p2-05-rapor.png` });
  });

  test('uygulama içi deneme: mini_exam önerisi → 3 soru → bitir → sonuç', async ({ page }) => {
    const me = await newStudent(page, 'sinav');
    const skills = await q<{ id: string }>(`select id::text from public.skills where curriculum_id = $1 order by id limit 3`, [me.curriculum_id]);
    expect(skills.length).toBe(3);
    const [ex] = await q<{ id: string }>(
      `insert into public.exams (curriculum_id, course_id, kind, source, title, status, question_count, duration_min, sections)
         select e.curriculum_id, e.course_id, 'published', 'instructor', 'TYT Mini Deneme', 'published', 3, 30,
                '[{"code":"Mat","title":"Matematik","from_no":1,"to_no":3,"minutes":30}]'::jsonb
           from public.enrollments e where e.id = $1 returning id::text`,
      [me.enrollment_id],
    );
    for (let i = 0; i < 3; i++) {
      const [eq] = await q<{ id: string }>(
        `insert into public.exam_questions (exam_id, no, kind, section, skill_ids, stem_text, options) values ($1, $2, 'mcq', 'Mat', $3, $4, $5::jsonb) returning id::text`,
        [ex!.id, i + 1, [skills[i]!.id], `Deneme sorusu ${i + 1}: ${i + 2} + ${i + 3} kaçtır?`, JSON.stringify(['A', 'B', 'C', 'D', 'E'].map((k, j) => ({ key: k, text: String(2 * i + 5 + j - 2) })))],
      );
      await q(`insert into secure.exam_answer_keys (exam_question_id, correct_option, source) values ($1, $2, 'instructor')`, [eq!.id, 'C']);
    }
    await q(
      `insert into public.suggestions (student_id, enrollment_id, kind, title, subtitle, payload, rank) values ($1, $2, 'mini_exam', 'TYT Mini Deneme', '3 soru · 30 dk', $3::jsonb, 0)`,
      [me.student_id, me.enrollment_id, JSON.stringify({ exam_id: ex!.id })],
    );

    await page.goto('/ogrenci');
    // kahraman kart başka bir alıştırma olabilir (rank 0 eşit); mini deneme kutudan açılır
    await page.getByRole('navigation', { name: 'Diğer çalışmalar' }).getByRole('button', { name: /Mini deneme: TYT Mini Deneme/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'TYT Mini Deneme' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Başla' })).toHaveCount(1);
    await page.getByRole('button', { name: 'Başla' }).click();
    await page.waitForURL(/\/ogrenci\/sinav\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('timer', { name: 'Kalan süre' })).toBeVisible();

    // 1: doğru (C), 2: yanlış (A), 3: boş bırakılır
    await expect(page.getByTestId('soru-no')).toHaveText('Soru 1 / 3');
    await page.getByRole('radio', { name: /C/ }).first().click();
    await page.getByRole('button', { name: 'Sonraki' }).click();
    await expect(page.getByTestId('soru-no')).toHaveText('Soru 2 / 3');
    await page.getByRole('radio', { name: /A/ }).first().click();
    await page.getByRole('button', { name: 'Sonraki' }).click();
    await expect(page.getByTestId('soru-no')).toHaveText('Soru 3 / 3');
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/p2-06-sinav-soru.png` });
    await page.getByRole('button', { name: 'Bitir' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Bitir' }).click();
    await page.waitForURL(/\/ogrenci\/sonuc\?deneme=[0-9a-f-]{36}/);

    // sonuç: tek cümle (yüzde yok), net = 1 doğru − 1 yanlış / 4
    const sentence = page.getByTestId('tek-cumle');
    await expect(sentence).toBeVisible({ timeout: 90_000 });
    expect((await sentence.innerText()).trim()).toMatch(/^[^!%]+\.$/);
    await expect(page.getByTestId('buyuk-sayi')).toContainText('0,75');
    await expect(page.getByRole('link', { name: 'Devam et' })).toHaveCount(1);
    await expect(page.getByText('%')).toHaveCount(0);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/p2-07-sinav-sonuc.png`, fullPage: true });
    const [ses] = await q<{ status: string; responses: number }>(
      `select es.status, (select count(*)::int from public.exam_responses r where r.session_id = es.id and r.answer is not null) as responses
         from public.exam_sessions es join public.enrollments e on e.id = es.enrollment_id where e.id = $1 and es.exam_id = $2`,
      [me.enrollment_id, ex!.id],
    );
    expect(ses).toEqual({ status: 'done', responses: 2 });
    // exam.report işi (rapor PDF'i) tamamlanır
    await until('exam.report', async () => (await q(`select 1 from pgboss.job where name = 'exam.report' and state = 'completed' and data ->> 'session_id' is not null`)).length > 0);
  });
});
