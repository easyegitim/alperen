import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import sharp from 'sharp';
import { BRIDGE_URL, JOURNEY_OTP, JOURNEY_WEB_URL } from './journey/config.mjs';
import { hasHorizontalOverflow } from './helpers';

// P1 öğrenci yolculuğu uçtan uca (OGRENMEN_LIVE=1; playwright.journey.config.ts): gerçek Postgres (geçici veritabanı:
// göçler + seed + TYT müfredatı + cevap anahtarları), Supabase uyumlu yerel köprü (RLS/RPC/Storage politikaları gerçek),
// gerçek worker (pg-boss) ve `next dev`; LLM her yerde sahte (OGRENMEN_LLM=fake). Ekranlar mockup S01–S07'ye göre:
// ekran başına tek birincil düğme, tek cümle sonuç, detay katlı.

const LIVE = process.env.OGRENMEN_LIVE === '1';
const SHOTS = 'test-results/journey/screens';

let pool: pg.Pool;

test.beforeAll(async () => {
  if (!LIVE) return;
  const info = (await (await fetch(`${BRIDGE_URL}/__info`)).json()) as { dbUrl: string };
  pool = new pg.Pool({ connectionString: info.dbUrl, max: 2 });
  // BİLİNEN BOŞLUK (README "Nerede kaldık"): TYT tohumunda alıştırma bankası yok; onaylı 20 soru teşhis testinindir ve
  // start_practice bitirilmemiş teşhisin sorusunu almaz, practice.generate'in işleyicisi de yok. Bu yüzden ilk öneri
  // "Bu konu için soruları hazırlıyorum" ekranında kalır. Yolculuk, test/student-flow.db.test.ts'teki gibi teşhis
  // sorularını alıştırma bankası sayar (öğrenci teşhisi bitirmiş gibi); gerisi gerçek akıştır.
  await pool.query(`update public.exams set kind = 'practice' where kind = 'diagnostic'`);
});
test.afterAll(async () => {
  await pool?.end();
});

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(sql, params)).rows as T[];
}

/** Bir koşul gerçekleşene dek veritabanını yoklar (worker işleri eşzamansız). */
async function until<T>(what: string, fn: () => Promise<T | null | undefined | false>, ms = 60_000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`beklenen durum oluşmadı: ${what}`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function signIn(page: Page, email: string) {
  await page.goto('/giris');
  await page.getByLabel('E-posta adresin').fill(email);
  await page.getByRole('button', { name: 'Kod gönder' }).click();
  await page.getByLabel('E-posta kodu').fill(JOURNEY_OTP);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
}

test.describe('P1 yolculuğu (gerçek Postgres + worker)', () => {
  test.skip(!LIVE, 'OGRENMEN_LIVE=1 gerekir (yerel Postgres)');

  test('yeni öğrenci: onboarding → Bugün → test → sonuç → koç → yükle → teşhis', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const email = `yolculuk-${Date.now()}@example.test`;

    // Giriş (e-posta kodu; köprü auth.users satırını açar) → profil yok → Hoş geldin → Öğrenciyim
    await signIn(page, email);
    await page.waitForURL(/\/hos-geldin/);
    await page.getByRole('link', { name: 'Öğrenciyim' }).click();

    // S01: "TYT Matematik" yazılır (seed müfredatı eşleşir), hedef tarih, tek birincil "Bitir"
    await expect(page.getByRole('heading', { level: 1, name: 'Hangi sınava hazırlanıyorsun?' })).toBeVisible();
    await page.getByLabel('Sınav veya ders ara').fill('TYT Matematik');
    await page.getByRole('button', { name: 'Devam' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Hedef tarihin?' })).toBeVisible();
    const examDate = new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel('Hedef tarih').fill(examDate);
    await page.getByRole('button', { name: 'Bitir' }).click();
    await page.waitForURL(`${JOURNEY_WEB_URL}/ogrenci`);

    const [me] = await q<{ profile_id: string; student_id: string; enrollment_id: string; curriculum_id: string; origin: string; status: string }>(
      `select s.profile_id::text, s.id::text as student_id, e.id::text as enrollment_id, e.curriculum_id::text, c.origin, c.status
         from auth.users u join public.students s on s.profile_id = u.id join public.enrollments e on e.student_id = s.id
         join public.curricula c on c.id = e.curriculum_id where u.email = $1`,
      [email],
    );
    expect(me).toMatchObject({ origin: 'seed', status: 'active' });

    // Bugün (S02): worker suggestions.refresh (onboarding_enroll kuyruğa attı) kahraman kartı yazar
    await until('suggestions.refresh öneri kartı', async () => (await q(`select 1 from public.suggestions where student_id = $1 and kind = 'practice'`, [me!.student_id])).length > 0);
    await page.reload();
    const hero = page.getByTestId('kahraman');
    await expect(hero.getByRole('button', { name: 'Başla' })).toBeVisible();
    await expect(page.locator('main').getByRole('button', { name: 'Başla', exact: true })).toHaveCount(1);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/01-bugun.png`, fullPage: true });

    // S04: Başla → sorular (gerçek start_practice / answer_practice_item; doğru şık tarayıcıya hiç gelmez)
    await hero.getByRole('button', { name: 'Başla' }).click();
    await page.waitForURL(/\/ogrenci\/test\/[0-9a-f-]{36}$/);
    const setId = page.url().split('/').at(-1)!;
    const progress = page.getByRole('progressbar', { name: /^Soru 1 \/ \d+$/ });
    await expect(progress).toBeVisible();
    const total = Number((await progress.getAttribute('aria-valuemax')) ?? '0');
    expect(total).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: `${SHOTS}/02-test.png`, fullPage: true });
    for (let i = 1; i <= total; i++) {
      await expect(page.getByRole('progressbar', { name: `Soru ${i} / ${total}` })).toBeVisible();
      const radios = page.getByRole('radio');
      if ((await radios.count()) > 0) await radios.first().click();
      else await page.getByLabel('Cevabın').fill('1');
      await page.getByRole('button', { name: i === total ? 'Bitir' : 'Sonraki' }).click();
    }

    // S05: tek cümle sonuç, tek birincil "Devam et"; set bitti, cevaplar attempts'e yazıldı
    await page.waitForURL(`${JOURNEY_WEB_URL}/ogrenci/test/${setId}/sonuc`);
    const sentence = page.getByTestId('tek-cumle');
    await expect(sentence).toBeVisible();
    expect((await sentence.innerText()).trim()).toMatch(/^[^!%]+\.$/);
    await expect(page.getByText(new RegExp(`^${total} sorudan \\d+ doğru$`))).toBeAttached();
    await expect(page.getByRole('link', { name: 'Devam et' })).toHaveCount(1);
    await expect(page.getByTestId('detay')).toBeHidden();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/03-test-sonuc.png`, fullPage: true });
    const [set] = await q<{ status: string; answered: number }>(
      `select ps.status, (select count(*)::int from public.attempts a where a.enrollment_id = ps.enrollment_id) as answered from public.practice_sets ps where ps.id = $1`,
      [setId],
    );
    expect(set).toEqual({ status: 'finished', answered: total });
    await page.getByRole('link', { name: 'Devam et' }).click();
    await page.waitForURL(`${JOURNEY_WEB_URL}/ogrenci`);

    // S03: Koç'ta bir tur (PgChatStore: gerçek dossier + sohbet satırları + llm_calls; sahte LLM)
    await page.getByRole('navigation', { name: 'Ana gezinme (alt çubuk)' }).getByRole('link', { name: 'Koç' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Koç' })).toBeVisible();
    await page.getByLabel('Koça yaz').fill('Bölünebilme kurallarını nasıl hatırlarım?');
    await page.getByRole('button', { name: 'Gönder' }).click();
    const log = page.getByRole('log', { name: 'Öğrenmen ile sohbet' });
    await expect(log.getByText('Bölünebilme kurallarını nasıl hatırlarım?')).toBeVisible();
    await expect(log.getByText(/Sahte yanıt \(coach_chat/)).toBeVisible();
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/04-koc.png`, fullPage: true });
    const msgs = await q<{ role: string }>(
      `select m.role from public.conversation_messages m join public.conversations c on c.id = m.conversation_id where c.student_id = $1 order by m.id`,
      [me!.student_id],
    );
    expect(msgs.map((m) => m.role).filter((r) => r !== 'system')).toEqual(['user', 'assistant']);
    expect((await q(`select 1 from public.llm_calls where route = 'coach_chat' and student_ref is not null`)).length).toBeGreaterThan(0);

    // S07: Yükle → Kendi çalışmam → fixture fotoğraf → Gönder (tarayıcı küçültür, Storage'a kendi klasörüne yükler)
    await page.goto('/ogrenci/yukle');
    await expect(page.getByRole('heading', { level: 1, name: 'Ne yüklüyorsun?' })).toBeVisible();
    await expect(page.getByLabel(/Kendi çalışmam/)).toBeChecked();
    const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 245, g: 244, b: 238 } } }).jpeg().toBuffer();
    await page.getByTestId('kamera-girisi').setInputFiles({ name: 'cozum.jpg', mimeType: 'image/jpeg', buffer: photo });
    await expect(page.getByText('1 sayfa hazır')).toBeVisible();
    await page.getByRole('button', { name: 'Gönder' }).click();
    await page.waitForURL(/\/ogrenci\/sonuc\?yukleme=[0-9a-f-]{36}$/);
    const uploadId = new URL(page.url()).searchParams.get('yukleme')!;
    const [up] = await q<{ storage_path: string; owner_id: string; width: number }>(`select storage_path, owner_id::text, width from public.uploads where id = $1`, [uploadId]);
    expect(up).toMatchObject({ storage_path: `${me!.profile_id}/${uploadId}.jpg`, owner_id: me!.profile_id });
    expect((await q(`select 1 from storage.objects where bucket_id = 'uploads' and name = $1`, [up!.storage_path])).length).toBe(1);

    // worker: upload.intake → diagnosis.run (sahte solution_diagnosis) → apply_diagnosis → solution_analyses
    await until('diagnosis.run', async () => (await q(`select 1 from public.solution_analyses where $1::uuid = any(upload_ids)`, [uploadId])).length > 0, 90_000);
    const jobs = await q<{ name: string; state: string }>(`select name, state from pgboss.job where name in ('upload.intake', 'diagnosis.run') order by created_on`);
    expect(jobs).toEqual([
      { name: 'upload.intake', state: 'completed' },
      { name: 'diagnosis.run', state: 'completed' },
    ]);

    // S05 (yükleme): bekleme ekranı kendiliğinden tek cümle sonuca döner; tek birincil "Devam et"
    const oneLine = page.getByTestId('tek-cumle');
    await expect(oneLine).toHaveText(/^Çözümünü inceledim: .+\.$/, { timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Devam et' })).toHaveAttribute('href', '/ogrenci');
    await expect(page.getByRole('link', { name: 'Detay' })).toHaveCount(1);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/05-yukle-sonuc.png`, fullPage: true });
  });

  test('yeni ders: onboarding taslak müfredat açar → worker curriculum.draft → Hazırlıyorum → Bugün', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const email = `taslak-${Date.now()}@example.test`;
    await signIn(page, email);
    await page.waitForURL(/\/hos-geldin/);
    await page.getByRole('link', { name: 'Öğrenciyim' }).click();
    await page.getByRole('button', { name: 'Üniversite dersi', exact: true }).click();
    await page.getByLabel('Sınav veya ders ara').fill('Lineer Cebir');
    await page.getByRole('button', { name: 'Devam' }).click();
    await page.getByRole('button', { name: 'Bilmiyorum' }).click();

    // Hazırlıyorum… (taslak sürerken); worker curriculum.draft (sahte curriculum_draft) ağacı kurar → Bugün
    await page.waitForURL(/\/ogrenci\/onboarding\?mufredat=[0-9a-f-]{36}$/);
    const curriculumId = new URL(page.url()).searchParams.get('mufredat')!;
    // (sahte taslak saniyeler sürer; ekran Bugün'e çoktan geçmiş olabilir)
    const cur = await until(
      'curriculum.draft',
      async () => (await q<{ origin: string; draft_status: string; skills: number }>(
        `select c.origin, c.draft_status, (select count(*)::int from public.skills k where k.curriculum_id = c.id) as skills from public.curricula c where c.id = $1 and c.draft_status in ('ready', 'failed')`,
        [curriculumId],
      ))[0],
      90_000,
    );
    expect(cur).toMatchObject({ origin: 'ai_draft', draft_status: 'ready' });
    expect(cur.skills).toBeGreaterThan(0);
    expect(await q(`select state from pgboss.job where name = 'curriculum.draft' and data ->> 'curriculum_id' = $1`, [curriculumId])).toEqual([{ state: 'completed' }]);
    await page.waitForURL(`${JOURNEY_WEB_URL}/ogrenci`, { timeout: 30_000 });
    // Öğrencinin yazdığı ders özel açılır (başka öğrencinin önerilerine düşmez)
    expect(await q(`select co.visibility from public.courses co where co.curriculum_id = $1`, [curriculumId])).toEqual([{ visibility: 'private' }]);
    // Bu dersin soru bankası boş (practice.generate işleyicisi yok; README "Nerede kaldık"): Bugün tek "İlk testine başla"
    await expect(page.locator('main').getByRole('button')).toHaveCount(1);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/07-taslak-bugun.png`, fullPage: true });
  });
});
