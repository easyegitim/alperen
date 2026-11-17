import { expect, test } from '@playwright/test';
import { hasHorizontalOverflow } from './helpers';
import { BRIDGE_URL, JOURNEY_WEB_URL } from './journey/config.mjs';
import { accessToken, closePool, LIVE, newStudent, openPool, q, SHOTS, signIn, until } from './journey/kit';

// P6 veli yolculuğu uçtan uca (OGRENMEN_LIVE=1; playwright.journey.config.ts): gerçek Postgres + köprü + gerçek worker + `next dev`; LLM sahte.
//   Öğrenci davet kodu üretir → veli kodla bağlanır → Özet (tek cümle) → Sohbet turu → Rapor iste → worker report.generate →
//   Özet'te "rapor hazır" kartı → PDF; veli koç sohbetini göremez (RPC 42501).

test.beforeAll(async () => {
  if (LIVE) await openPool();
});
test.afterAll(async () => {
  await closePool();
});

test.describe('P6 veli yolculuğu (gerçek Postgres + worker)', () => {
  test.skip(!LIVE, 'OGRENMEN_LIVE=1 gerekir (yerel Postgres)');

  test('davet → bağlan → Özet → Sohbet → Rapor iste → PDF; koç sohbeti kapalı', async ({ browser }) => {
    // --- öğrenci davet üretir
    const sPage = await (await browser.newContext()).newPage();
    const me = await newStudent(sPage, 'veli-ogrenci');
    await sPage.goto('/ogrenci/profil');
    await sPage.getByRole('button', { name: 'Veli davet et' }).click();
    const kodEl = sPage.getByTestId('davet-kodu');
    await expect(kodEl).toBeVisible();
    const kod = ((await kodEl.textContent()) ?? '').trim();
    expect(kod).toMatch(/^gi_[a-z2-7]{32}$/);

    // --- veli kodla bağlanır
    const pCtx = await browser.newContext();
    const page = await pCtx.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    const parentEmail = `veli-${Date.now()}@example.test`;
    await signIn(page, parentEmail);
    await page.waitForURL(/\/hos-geldin/);
    await page.goto(`/davet?kod=${kod}`);
    await expect(page).toHaveURL(`${JOURNEY_WEB_URL}/hos-geldin?rol=veli&kod=${kod}`);
    await page.getByLabel('Adın').fill('Fatma Yılmaz');
    await page.getByRole('button', { name: 'Daveti kabul et' }).click();
    await expect(page).toHaveURL(`${JOURNEY_WEB_URL}/veli`);
    const [link] = await q<{ n: number }>(`select count(*)::int as n from public.guardian_links gl where gl.student_id = $1 and gl.status = 'active' and gl.parent_id is not null`, [me.student_id]);
    expect(link!.n).toBe(1);

    // --- Özet: tek cümle, yüzde yok, taşma yok
    const status = page.getByTestId('veli-durum');
    await expect(status).toBeVisible();
    const sentence = ((await status.textContent()) ?? '').trim();
    expect(sentence.length).toBeGreaterThan(10);
    expect(sentence).not.toMatch(/%|!/);
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/p6-01-ozet.png`, fullPage: true });

    // --- Sohbet turu (akışlı yanıt; sahte LLM)
    await page.getByRole('link', { name: 'Soru sor' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sohbet' })).toBeVisible();
    const box = page.getByLabel('Öğrenmen’e sorun');
    // `next dev` ilk açılışta hidrasyon gecikebilir (yazı girilir ama durum güncellenmez, Gönder kapalı kalır): yeniden dene
    const send = page.getByRole('button', { name: 'Gönder' });
    await expect(async () => {
      await box.fill('');
      await box.fill('Bu hafta nasıl gitti?');
      await expect(send).toBeEnabled({ timeout: 3_000 });
    }).toPass({ timeout: 45_000 });
    const replied = page.waitForResponse((r) => r.url().endsWith('/api/parent-chat') && r.request().method() === 'POST');
    await send.click();
    expect((await replied).status()).toBe(200);
    const log = page.getByRole('log');
    await expect(log).toContainText('Bu hafta nasıl gitti?');
    await until('ajan yanıtı kaydedildi', async () => (await q(`select 1 from public.conversation_messages m join public.conversations c on c.id = m.conversation_id where c.kind = 'parent' and c.student_id = $1 and m.role = 'assistant'`, [me.student_id]).catch(() => [])).length > 0, 60_000);
    await page.reload();
    await expect(page.getByRole('log')).toContainText('Bu hafta nasıl gitti?');
    expect(await hasHorizontalOverflow(page)).toBe(false);
    await page.screenshot({ path: `${SHOTS}/p6-02-sohbet.png`, fullPage: true });

    // --- Rapor iste (haftalık) → report.generate → PDF
    await page.goto('/veli');
    await page.getByTestId('rapor-iste').click();
    await page.getByRole('radio', { name: 'Haftalık' }).click();
    await page.getByRole('button', { name: 'İste' }).click();
    await expect(page.getByTestId('rapor-durum')).toHaveText('Raporu hazırlıyorum; hazır olunca haber vereceğim.');
    const doc = await until('rapor yayımlandı', async () => {
      const r = await q<{ id: string; status: string; pdf_path: string | null }>(`select id::text, status, pdf_path from public.generated_documents where student_id = $1 and kind = 'report'`, [me.student_id]);
      if (r[0]?.status === 'failed') throw new Error('rapor üretimi başarısız');
      return r[0]?.pdf_path && ['published', 'rendered'].includes(r[0].status) ? r[0] : null;
    }, 180_000);
    const token = await accessToken(page);
    const pdf = await fetch(`${BRIDGE_URL}/storage/v1/object/documents/${doc.pdf_path}`, { headers: { authorization: `Bearer ${token}` } });
    expect(pdf.status).toBe(200);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    expect(bytes.length).toBeGreaterThan(1000);
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF');

    await page.goto('/veli');
    const card = page.getByTestId('bildirim').filter({ hasText: /rapor/i }).first();
    await expect(card).toBeVisible({ timeout: 60_000 });
    await card.getByRole('link').first().click();
    await page.waitForURL(/\/veli\/rapor\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId('belge-goruntuleyici').locator('canvas').first()).toBeVisible({ timeout: 45_000 });
    await page.screenshot({ path: `${SHOTS}/p6-03-rapor-pdf.png` });

    // --- veli koç sohbetini göremez: koç RPC'leri veliye 42501
    for (const [fn, body] of [
      ['coach_history', { p_conversation: null, p_limit: 20, p_after_id: null }],
      ['coach_open_conversation', { p_course: me.course_id, p_mode: 'hint' }],
    ] as const) {
      const res = await fetch(`${BRIDGE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, apikey: token, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect(res.status, fn).toBe(403);
      expect(((await res.json()) as { code: string }).code, fn).toBe('42501');
    }
    // ... ve başkasının çocuğu için parent-chat 403
    const other = await page.request.post('/api/parent-chat', { data: { student_id: '10000000-0000-4000-8000-0000000000ff', text: 'merhaba' }, maxRedirects: 0 });
    expect(other.status()).toBe(403);
  });
});
