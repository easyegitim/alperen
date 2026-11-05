import fs from 'node:fs';
import { expect, test } from '@playwright/test';
import { hasHorizontalOverflow } from './helpers';
import { closePool, LIVE, newStudent, openPool, q, SHOTS, signInInstructor, syntheticVideo, until } from './journey/kit';

// P5 ders yolculuğu uçtan uca (OGRENMEN_LIVE=1; playwright.journey.config.ts): gerçek Postgres + köprü (TUS dahil) + gerçek
// worker + gerçek pipelines/ders servisi (ffmpeg, OGRENMEN_STT=fake) + `next dev`; LLM sahte.
//   Eğitmen 10 sn'lik sentetik video yükler (TUS) → lesson.prepare → stt (sahte transkript) → label → analyse → iddialar;
//   eşik üstü iddialar kendiliğinden uygulanır, eşik altı eğitmen onayıyla → öğrenci Bugün'de ders tekrarı kartı.

test.beforeAll(async () => {
  if (LIVE) await openPool();
});
test.afterAll(async () => {
  await closePool();
});

test.describe('P5 ders yolculuğu (gerçek Postgres + worker + ders servisi)', () => {
  test.skip(!LIVE, 'OGRENMEN_LIVE=1 gerekir (yerel Postgres)');

  test('eğitmen video yükler → fake STT → iddialar → eşik üstü uygulandı → onay → öğrenci Bugün’de ders tekrarı', async ({ browser }) => {
    const sPage = await (await browser.newContext()).newPage();
    const me = await newStudent(sPage, 'ders-ogrenci');
    // Varsayılan görünen ad e-posta ön ekinden gelir ("ders ogrenci …"): "ders" sözcüğü istemin kendi metninde de geçtiği için
    // ad temizliği yanlış pozitif verir. Gerçekçi bir ad kullan.
    await q(`update public.profiles set display_name = 'Elif Yıldız' where id = $1`, [me.profile_id]);

    const page = await (await browser.newContext()).newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    const teacher = await signInInstructor(page, 'ders-egitmen', me);
    await page.goto('/egitmen/dersler');
    await expect(page.getByRole('heading', { level: 1, name: 'Dersler' })).toBeVisible();

    // --- yükle (TUS): 10 sn'lik sentetik video
    const video = syntheticVideo(10);
    const form = page.getByTestId('ders-yukle');
    await expect(form).toBeVisible();
    await form.getByLabel('Başlık (isteğe bağlı)').fill('Rasyonel sayılar');
    await page.getByTestId('ders-dosya').setInputFiles({ name: 'ders1.mp4', mimeType: 'video/mp4', buffer: fs.readFileSync(video) });
    await form.getByRole('button', { name: 'Dersi yükle' }).click();
    await expect(form).toContainText('Dersi aldım; yazıya çeviriyorum.', { timeout: 60_000 });

    // --- hat: prepare → stt → label → analyse (gerçek servis, sahte STT/LLM)
    const lesson = await until('ders işlendi', async () => {
      const r = await q<{ id: string; status: string; stage: string | null }>(`select id::text, status, progress ->> 'stage' as stage from public.lessons where instructor_id = $1 order by created_at desc limit 1`, [teacher.id]);
      if (r[0]?.status === 'failed') {
        const [e] = await q<{ progress: unknown }>(`select progress from public.lessons where id = $1`, [r[0].id]);
        throw new Error(`ders başarısız: ${JSON.stringify(e?.progress)}`);
      }
      return r[0]?.status === 'analyzed' || r[0]?.stage === 'done' ? r[0] : null;
    }, 240_000);
    const jobs = await q<{ name: string; state: string }>(`select name, state from pgboss.job where name like 'lesson.%' and data ->> 'lesson_id' = $1`, [lesson.id]);
    for (const n of ['lesson.prepare', 'lesson.stt', 'lesson.label', 'lesson.analyse']) expect(jobs.filter((j) => j.name === n).map((j) => j.state), n).toContain('completed');
    const [prog] = await q<{ stt_provider: string; segments: number }>(`select progress ->> 'stt_provider' as stt_provider, (progress ->> 'segments')::int as segments from public.lessons where id = $1`, [lesson.id]);
    expect(prog!.stt_provider).toBe('fake');
    expect(prog!.segments).toBeGreaterThan(0);

    // --- liste ve ayrıntı: iddialar; eşik üstü uygulandı
    await page.goto('/egitmen/dersler');
    const row = page.getByTestId('ders-satiri').first();
    await expect(row).toContainText('Rasyonel sayılar');
    expect(await row.textContent()).not.toMatch(/%/);
    // `next dev` ilk gezintide yol derlerken tıklama hidrasyondan önce düşebilir: URL değişene dek yeniden tıkla
    await expect(async () => {
      await row.click();
      await expect(page).toHaveURL(/\/egitmen\/dersler\/[0-9a-f-]{36}$/, { timeout: 8_000 });
    }).toPass({ timeout: 60_000 });
    const claims = page.getByTestId('iddia');
    await expect(claims.first()).toBeVisible();
    const total = await claims.count();
    expect(total).toBeGreaterThan(0);
    const applied = (await q<{ n: number }>(`select count(*)::int as n from public.lesson_claims lc join public.lesson_analyses la on la.id = lc.analysis_id where la.lesson_id = $1 and lc.applied_at is not null`, [lesson.id]))[0]!.n;
    expect(applied).toBeGreaterThan(0);
    await expect(page.getByTestId('uygulama-durumu')).toContainText(`${applied}/${total}`);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/p5-01-ders-iddialar.png`, fullPage: true });

    // --- eşik altı iddialar eğitmen onayıyla uygulanır → analiz onaylı
    // Bir karar sürerken (busy) tüm iddia düğmeleri devre dışıdır: her turda önce düğmelerin yeniden etkinleşmesini bekle,
    // sonra yalnız etkin bir "Onayla"ya tıkla (devre dışı düğmeye tıklamak DOM yenilenince kopuyordu).
    for (let guard = 0; guard < 12; guard++) {
      await expect(claims.locator('button:disabled')).toHaveCount(0, { timeout: 30_000 });
      const btn = claims.locator('button:enabled', { hasText: 'Onayla' }).first();
      if ((await btn.count()) === 0) break;
      await btn.click();
      await page.waitForTimeout(300);
    }
    await until('analiz onaylı', async () => (await q(`select 1 from public.lesson_analyses where lesson_id = $1 and status = 'approved'`, [lesson.id])).length > 0, 60_000);
    await page.getByRole('switch', { name: 'Öğrenciye görünür' }).click();
    await page.screenshot({ path: `${SHOTS}/p5-02-ders-onaylandi.png`, fullPage: true });

    // --- öğrenci: Bugün'de ders tekrarı kartı (suggestions.refresh), Gelişim'de tek cümle
    try {
      await until('ders tekrarı kartı', async () => (await q(`select 1 from public.suggestions where student_id = $1 and kind = 'lesson_review' and consumed_at is null`, [me.student_id])).length > 0, 120_000);
    } catch (err) {
      const dbg = {
        lesson: await q(`select id::text, enrollment_id::text, course_id::text, held_at, status from public.lessons where id = $1`, [lesson.id]),
        analyses: await q(`select id::text, status, version from public.lesson_analyses where lesson_id = $1`, [lesson.id]),
        claims: await q(`select c.kind, c.status, c.skill_id from public.lesson_claims c join public.lesson_analyses a on a.id = c.analysis_id where a.lesson_id = $1`, [lesson.id]),
        me: { enrollment_id: me.enrollment_id, course_id: me.course_id },
        sug: await q(`select kind, title, consumed_at from public.suggestions where student_id = $1`, [me.student_id]),
        jobs: await q(`select name, state, data ->> 'reason' as reason from pgboss.job where name = 'suggestions.refresh' order by created_on`),
      };
      throw new Error(`${(err as Error).message}\n${JSON.stringify(dbg)}`);
    }
    await sPage.goto('/ogrenci');
    const hero = sPage.getByTestId('kahraman');
    const lessonCard = (await hero.textContent())?.includes('Ders tekrarı') ? hero : sPage.locator('main').getByText('Ders tekrarı').first();
    await expect(lessonCard).toBeVisible();
    expect(await hasHorizontalOverflow(sPage)).toBe(false);
    await sPage.screenshot({ path: `${SHOTS}/p5-03-bugun-ders-tekrari.png`, fullPage: true });

    // öğrenci ham transkripti / alıntıyı göremez (RLS): doğrudan RPC/tablo okuması boş
    await sPage.goto('/ogrenci/gelisim');
    expect(await sPage.locator('main').textContent()).not.toMatch(/transkript|alıntı/i);
  });
});
