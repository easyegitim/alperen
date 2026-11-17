import { expect, test } from '@playwright/test';
import { hasHorizontalOverflow } from './helpers';
import { closePool, jobDone, LIVE, newStudent, openPool, q, SHOTS, signInInstructor, syntheticPdf, until } from './journey/kit';

// P4 tarz kütüphanesi yolculuğu uçtan uca (OGRENMEN_LIVE=1; playwright.journey.config.ts): gerçek Postgres + köprü + gerçek worker
// (pg-boss, pdftoppm, SymPy anahtar denetimi) + `next dev`; LLM sahte.
//   Eğitmen sentetik çıkmış sınav yükler (2024, 2025) → style.ingest → tarzlar → öncelik planı onayı → "5 soru üret" →
//   öğrenci Bugün'de tarz kartı → Başla → sorular.

test.beforeAll(async () => {
  if (LIVE) await openPool();
});
test.afterAll(async () => {
  await closePool();
});

test.describe('P4 tarz yolculuğu (gerçek Postgres + worker)', () => {
  test.skip(!LIVE, 'OGRENMEN_LIVE=1 gerekir (yerel Postgres)');

  test('eğitmen çıkmış sınav yükler → tarzlar → öncelik → soru üretir → öğrenci Bugün’de tarz kartı → Başla', async ({ browser }) => {
    const sPage = await (await browser.newContext()).newPage();
    const me = await newStudent(sPage, 'tarz-ogrenci');

    const iCtx = await browser.newContext();
    const page = await iCtx.newPage();
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInInstructor(page, 'tarz-egitmen', me);
    await page.goto(`/egitmen/soru-tarzlari?course=${me.course_id}`);
    await expect(page.getByRole('heading', { level: 1, name: /Soru tarzları · / })).toBeVisible();

    // --- iki sınav yılı yüklenir; her biri style.ingest ile tarzlara ayrılır (sahte OCR/madde/adlandırma fikstürleri)
    async function upload(year: number) {
      const form = page.getByTestId('arsiv-yukle');
      if (!(await form.isVisible())) await page.getByText('Çıkmış sınav yükle').first().click();
      await form.getByLabel('Sınav yılı').fill(String(year));
      await form.getByLabel('Sınav türü').selectOption('final');
      await form.getByTestId('arsiv-dosya').setInputFiles({ name: `tyt-${year}.pdf`, mimeType: 'application/pdf', buffer: syntheticPdf(year) });
      await form.getByRole('button', { name: 'Yükle' }).click();
      await expect(form).toContainText(`${year} sınavını aldım`, { timeout: 60_000 });
      const [src] = await q<{ id: string }>(`select id::text from public.exam_sources where course_id = $1 and year = $2`, [me.course_id, year]);
      await jobDone('style.ingest', 'source_id', src!.id, 180_000);
    }
    await upload(2024);
    await upload(2025);

    await page.goto(`/egitmen/soru-tarzlari?course=${me.course_id}`);
    const lib = page.getByTestId('tarz-kutuphanesi');
    await expect(lib.getByTestId('tarz-kesir-islem-onceligi')).toContainText('Kesirlerle işlem önceliği');
    expect(await q(`select 1 from public.question_styles where course_id = $1`, [me.course_id])).toHaveLength(4);
    await page.screenshot({ path: `${SHOTS}/p4-01-tarzlar.png`, fullPage: true });

    // --- öncelik planı: onayı bekliyor → Onayla; "tahmin/yüzde" dili yok
    const block = page.getByTestId('oncelikler');
    await expect(block).toContainText('Onayını bekliyor');
    expect(await block.textContent()).not.toMatch(/%|tahmin|çıkacak/i);
    await block.getByRole('button', { name: /^Onayla$/ }).click();
    await expect(block).toContainText('Onaylandı');
    const [plan] = await q<{ status: string }>(`select status from public.exam_priority_plans where course_id = $1 order by created_at desc limit 1`, [me.course_id]);
    expect(plan!.status).toBe('approved');

    // --- tarzı etkinleştir (Kaydet = onay) ve "5 soru üret"
    const card = page.getByTestId('tarz-kesir-islem-onceligi');
    await card.getByRole('button', { name: 'Düzenle' }).click();
    await card.getByRole('button', { name: 'Kaydet' }).click();
    await expect(card).not.toContainText('Taslak');
    await card.getByRole('button', { name: '5 soru üret' }).click();
    await expect(lib).toContainText('5 soru üretmeye başladım');
    const [style] = await q<{ id: string }>(`select id::text from public.question_styles where course_id = $1 and code = 'kesir-islem-onceligi'`, [me.course_id]);
    await until('tarz sorusu bankada (doğrulanmış)', async () => (await q(`select 1 from public.questions q join secure.answer_keys k on k.question_id = q.id where q.style_id = $1 and q.status = 'approved' and k.sympy_status = 'verified'`, [style!.id])).length > 0, 180_000);
    expect(await hasHorizontalOverflow(page)).toBe(false);

    // --- öğrenci Bugün: tarz kartı ("Bu tarzı hiç çözmedin"); çıkmış soru metni yok
    await until('tarz kartı (suggestions)', async () => (await q(`select 1 from public.suggestions where student_id = $1 and payload ->> 'style_id' = $2`, [me.student_id, style!.id])).length > 0, 120_000);
    await sPage.goto('/ogrenci');
    const main = sPage.locator('main');
    // Tarz kartı kahraman olmayabilir (başka öneri öndedir): "Diğer çalışmalar" kutusu yalnız başlık + süre taşır;
    // "Bu tarzı hiç çözmedin" alt başlığı yalnız kahraman kartında görünür.
    // Kutu başlığı yalnız erişilebilir adda (aria-label) taşınır; görünür metin tür + süredir.
    await expect(sPage.getByRole('button', { name: /Kesirlerle işlem önceliği/ }).or(sPage.getByTestId('kahraman').filter({ hasText: 'Kesirlerle işlem önceliği' }))).toBeVisible({ timeout: 30_000 });
    const [sug] = await q<{ subtitle: string }>(`select subtitle from public.suggestions where student_id = $1 and payload ->> 'style_id' = $2`, [me.student_id, style!.id]);
    expect(sug!.subtitle).toContain('Bu tarzı hiç çözmedin');
    expect(await main.textContent()).not.toMatch(/%\s?\d|\d\s?%/);
    expect(await hasHorizontalOverflow(sPage)).toBe(false);
    await sPage.screenshot({ path: `${SHOTS}/p4-02-bugun-tarz-karti.png`, fullPage: true });

    // Başla: tarz kartı kahramansa "Başla", değilse "Diğer çalışmalar" kutusu
    const hero = sPage.getByTestId('kahraman');
    if ((await hero.textContent())?.includes('Kesirlerle işlem önceliği')) await hero.getByRole('button', { name: 'Başla' }).click();
    else await sPage.getByRole('button', { name: /Kesirlerle işlem önceliği/ }).click();
    await sPage.waitForURL(/\/ogrenci\/test\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    await expect(sPage.getByRole('progressbar', { name: /^Soru 1 \/ \d+$/ })).toBeVisible({ timeout: 30_000 });
    const setId = new URL(sPage.url()).pathname.split('/').pop()!;
    const [set] = await q<{ n: number; styled: number }>(
      `select count(*)::int as n, count(*) filter (where q.style_id = $2)::int as styled
         from public.practice_set_items i join public.questions q on q.id = i.question_id where i.set_id = $1`,
      [setId, style!.id],
    );
    expect(set!.n).toBeGreaterThan(0);
    expect(set!.styled).toBeGreaterThan(0);
    await sPage.screenshot({ path: `${SHOTS}/p4-03-tarz-sorusu.png`, fullPage: true });
  });
});
