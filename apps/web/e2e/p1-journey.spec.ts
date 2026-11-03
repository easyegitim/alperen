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
  // İlk Başla gerçek bankadan gelir (0027): atanmamış teşhisin onaylı soruları + ön ısıtma (suggestions.refresh →
  // practice.prewarm: şablon + sahte LLM); bankası boş yaprakta practice.generate (üçüncü test). Veritabanına el değmez;
  // istisnalar: ikinci testte eğitmen yayını (curriculum_publish) güvenilir oturumla çağrılır, üçüncü testte
  // practice.generate işinin başlangıcı ertelenir (bekleme ekranı yarışsız).
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

/** @supabase/ssr oturum çerezinden (sb-…-auth-token, parçalı olabilir; "base64-" önekli) erişim jetonu. */
async function accessToken(page: Page): Promise<string> {
  const cookies = (await page.context().cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name));
  cookies.sort((a, b) => Number(a.name.split('.').at(-1)) - Number(b.name.split('.').at(-1)));
  let raw = cookies.map((c) => decodeURIComponent(c.value)).join('');
  if (raw.startsWith('base64-')) raw = Buffer.from(raw.slice(7), 'base64url').toString('utf8');
  const tok = (JSON.parse(raw) as { access_token?: string }).access_token;
  if (!tok) throw new Error('oturum çerezi yok');
  return tok;
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
    // ilk kartın yaprakları ön ısıtıldı (practice.prewarm): şablonlu yaprak şablonla, öteki sahte LLM ile
    const prewarm = await until(
      'practice.prewarm',
      async () => (await q<{ state: string }>(
        `select state from pgboss.job where name = 'practice.prewarm' and data ->> 'enrollment_id' = $1 and state in ('completed', 'failed')`,
        [me!.enrollment_id],
      ))[0],
      60_000,
    );
    expect(prewarm.state).toBe('completed');
    const warmed = await q<{ source: string }>(
      `select distinct q.source from public.questions q join secure.answer_keys k on k.question_id = q.id
        where q.curriculum_id = $1 and q.status = 'approved' and q.source in ('template', 'llm') order by 1`,
      [me!.curriculum_id],
    );
    expect(warmed.map((r) => r.source)).toEqual(['llm', 'template']);
    await page.getByRole('link', { name: 'Devam et' }).click();
    await page.waitForURL(`${JOURNEY_WEB_URL}/ogrenci`);

    // S03: Koç'ta bir tur (SupabaseChatStore: kullanıcının JWT'si + koç RPC'leri; gerçek dossier, sohbet satırları,
    // llm_calls; assistant turu ve defter sunucu jetonuyla; sahte LLM)
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
    const [reply] = await q<{ conversation_id: string; llm_call_id: string | null }>(
      `select m.conversation_id, m.llm_call_id from public.conversation_messages m join public.conversations c on c.id = m.conversation_id
        where c.student_id = $1 and m.role = 'assistant' order by m.id desc limit 1`,
      [me!.student_id],
    );
    expect(reply?.llm_call_id).not.toBeNull();
    // İstemciden model turu taklidi: tarayıcının oturum jetonuyla PostgREST'e doğrudan (sunucu jetonu olmadan) assistant
    // mesajı reddedilir (OGR-COACH-001); öğrencinin kendi user mesajı geçer.
    const token = await accessToken(page);
    const rpc = (fn: string, body: Record<string, unknown>) =>
      fetch(`${BRIDGE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const forged = await rpc('coach_append_message', { p_conversation: reply!.conversation_id, p_role: 'assistant', p_content: [{ type: 'text', text: 'Koç: cevap A.' }] });
    expect(forged.status).toBe(403);
    expect(((await forged.json()) as { message: string }).message).toContain('OGR-COACH-001');
    const forgedLedger = await rpc('coach_log_llm_call', { p_conversation: reply!.conversation_id, p_call: { route: 'coach_chat', model: 'm', status: 'ok' } });
    expect(forgedLedger.status).toBe(403);
    expect((await q(`select 1 from public.conversation_messages where content @> '[{"text": "Koç: cevap A."}]'`)).length).toBe(0);

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
    // Eğitmen onayı bekleyen (otopilotsuz, üniversite) taslak: ön ısıtma ücretli üretim yapmaz (practice.prewarm skipped);
    // Bugün düğmesiz "Planın eğitmen onayında" (start_practice burada OGR-PRAC-008 verirdi)
    const warm = await until(
      'practice.prewarm (taslak)',
      async () => (await q<{ state: string; status: string | null }>(
        `select j.state, j.output ->> 'status' as status from pgboss.job j join public.enrollments e on e.id = (j.data ->> 'enrollment_id')::uuid
          where j.name = 'practice.prewarm' and e.curriculum_id = $1 and j.state in ('completed', 'failed')`,
        [curriculumId],
      ))[0],
      60_000,
    );
    expect(warm).toEqual({ state: 'completed', status: 'skipped' });
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Planın eğitmen onayında' })).toBeVisible();
    await expect(page.locator('main').getByRole('button')).toHaveCount(0);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/07-taslak-bugun.png`, fullPage: true });

    // Eğitmen yayını (curriculum_publish; burada güvenilir oturumla) → ilk 'practice' kartı + practice.prewarm (kartın
    // yaprakları, sahte LLM) → Bugün'de tek Başla → ilk Başla soru getirir (bankadan ya da practice.generate ile)
    const [pub] = await q<{ r: { status: string; suggestions: number } }>(`select public.curriculum_publish($1::uuid) as r`, [curriculumId]);
    expect(pub!.r).toMatchObject({ status: 'active', suggestions: 1 });
    const warmed = await until(
      'practice.prewarm (yayın)',
      async () => (await q<{ state: string; status: string | null }>(
        `select j.state, j.output ->> 'status' as status from pgboss.job j join public.enrollments e on e.id = (j.data ->> 'enrollment_id')::uuid
          where j.name = 'practice.prewarm' and e.curriculum_id = $1 and j.data ->> 'reason' = 'curriculum_ready'
            and j.state in ('completed', 'failed')`,
        [curriculumId],
      ))[0],
      60_000,
    );
    expect(warmed).toEqual({ state: 'completed', status: 'warmed' });
    await page.reload();
    const hero = page.getByTestId('kahraman');
    await expect(hero.getByRole('button', { name: 'Başla' })).toBeVisible();
    const t0 = Date.now();
    await hero.getByRole('button', { name: 'Başla' }).click();
    await page.waitForURL(/\/ogrenci\/test\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('progressbar', { name: /^Soru 1 \/ \d+$/ })).toBeVisible({ timeout: 30_000 });
    expect(Date.now() - t0).toBeLessThan(30_000);
    const setId = new URL(page.url()).pathname.split('/').pop()!;
    const [set] = await q<{ status: string; items: number; llm: number }>(
      `select ps.status, count(i.*)::int as items, count(*) filter (where q.source = 'llm')::int as llm
         from public.practice_sets ps join public.practice_set_items i on i.set_id = ps.id join public.questions q on q.id = i.question_id
        where ps.id = $1 group by ps.status`,
      [setId],
    );
    expect(set).toMatchObject({ status: 'in_progress' });
    expect(set!.items).toBeGreaterThan(0);
    expect(set!.llm).toBe(set!.items);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/08-yayin-ilk-test.png`, fullPage: true });
  });

  test('bankası boş yaprak: needs_generation → practice.generate (sahte LLM) → bekleme ekranı oynatıcıya döner', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const email = `uretim-${Date.now()}@example.test`;
    await signIn(page, email);
    await page.waitForURL(/\/hos-geldin/);
    await page.getByRole('link', { name: 'Öğrenciyim' }).click();
    await page.getByLabel('Sınav veya ders ara').fill('TYT Matematik');
    await page.getByRole('button', { name: 'Devam' }).click();
    await page.getByRole('button', { name: 'Bilmiyorum' }).click();
    await page.waitForURL(`${JOURNEY_WEB_URL}/ogrenci`);
    const [me] = await q<{ enrollment_id: string }>(
      `select e.id::text as enrollment_id from auth.users u join public.students s on s.profile_id = u.id
         join public.enrollments e on e.student_id = s.id where u.email = $1`,
      [email],
    );
    // İşçi–havuz problemleri: şablonu ve teşhis sorusu yok → banka boş → start_practice işi kuyruğa atar (koç yolu, worker gibi).
    // İş aynı işlemde ertelenir (start_after): worker işi commit'ten önce göremez, bekleme ekranı yarışsız sınanır.
    const c = await pool.connect();
    let started: { set_id: string; status: string; total: number };
    let jobId: string | undefined;
    try {
      await c.query('begin');
      started = (await c.query(`select public.start_practice(null, $1::uuid, array['tyt.mat.problem.isci'], 4) as s`, [me!.enrollment_id])).rows[0].s;
      jobId = (await c.query(
        `update pgboss.job set start_after = now() + interval '1 hour'
          where name = 'practice.generate' and data ->> 'set_id' = $1 and state = 'created' returning id::text`,
        [started.set_id],
      )).rows[0]?.id;
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
    expect(started.status).toBe('needs_generation');
    expect(started.total).toBe(0);
    expect(jobId).toBeTruthy();
    await page.goto(`/ogrenci/test/${started.set_id}`);
    await expect(page.getByTestId('soru-hazirlaniyor')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Soruları hazırlıyorum…' })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/06-soru-hazirlaniyor.png`, fullPage: true });
    // işi serbest bırak: worker alır, sahte LLM soruları yazar, bekleme ekranı oynatıcıya döner
    const t0 = Date.now();
    await q(`update pgboss.job set start_after = now() where id = $1::uuid`, [jobId]);
    await expect(page.getByRole('progressbar', { name: 'Soru 1 / 4' })).toBeVisible({ timeout: 30_000 });
    expect(Date.now() - t0).toBeLessThan(30_000);
    const job = await until(
      'practice.generate',
      async () => (await q<{ state: string; status: string; llm: number; secs: number }>(
        `select state, output ->> 'status' as status, (output ->> 'llm_items')::int as llm,
                extract(epoch from (completed_on - started_on))::float as secs
           from pgboss.job where name = 'practice.generate' and data ->> 'set_id' = $1 and state in ('completed', 'failed')`,
        [started.set_id],
      ))[0],
    );
    expect(job).toMatchObject({ state: 'completed', status: 'in_progress', llm: 4 }); // sahte LLM 8 soru döner, ihtiyaç kadarı (4) yazılır
    expect(job.secs).toBeLessThan(5);
    const items = await q<{ source: string; sympy: string }>(
      `select q.source, q.verification ->> 'sympy' as sympy from public.practice_set_items i join public.questions q on q.id = i.question_id where i.set_id = $1`,
      [started.set_id],
    );
    expect(items).toHaveLength(4);
    // sahte fikstürün anahtarları SymPy denetiminden geçer (apps/worker/py/key_verify.py)
    for (const it of items) expect(it).toEqual({ source: 'llm', sympy: 'verified' });
    expect(await hasHorizontalOverflow(page)).toBe(false);
  });
});
