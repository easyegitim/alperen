// Sayfa davranışları (BLUEPRINT §7 test listesi): mock veri kaynağı + gerçek bundle.js.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, waitFor, within } from '@testing-library/react';
import OverviewPage from '../app/page';
import DerslerPage from '../app/dersler/page';
import DersPage from '../app/ders/page';
import CevaplarPage from '../app/cevaplar/page';
import KuyrukPage from '../app/kuyruk/page';
import OncelikPage from '../app/oncelik/page';
import GruplarPage from '../app/gruplar/page';
import OgrencilerPage from '../app/ogrenciler/page';
import OgrenciPage from '../app/ogrenci/page';
import OnaylarPage from '../app/onaylar/page';
import MaliyetPage from '../app/maliyet/page';
import OnayPage from '../app/onay/page';
import GirisPage from '../app/giris/page';
import { MOCK_WEB_TOKEN } from '../lib/data/mock';
import { GateBlock } from '../components/GateBlock';
import { evaluatePilotGate } from '../lib/pilot-gate';
import { buttonsNamed, loadDs, primaryCount, readJson, renderPage } from './helpers';

const ANALYSIS_ID = '6c9f9fd0-59cc-5f1c-94eb-4a41b4edc0af';
const SOZEL_QUESTION = 'question:0a86bcef-4c31-5214-a19f-7e6d5cf47e9c';
const RESEARCH = 'research:b9ed1ca1-1f34-59a3-a829-cec38fa3296b';
const FULL_NAMES = ['Elif Kaya', 'Mert Demir', 'Zeynep Çelik'];
const ALL_PAGES = [
  ['/', OverviewPage],
  ['/dersler', DerslerPage],
  ['/ders', DersPage, { id: ANALYSIS_ID }],
  ['/cevaplar', CevaplarPage],
  ['/kuyruk', KuyrukPage],
  ['/oncelik', OncelikPage],
  ['/gruplar', GruplarPage],
  ['/ogrenciler', OgrencilerPage],
  ['/ogrenci', OgrenciPage, { ref: 's_vd3hp6wz2kc7' }],
  ['/onaylar', OnaylarPage],
  ['/maliyet', MaliyetPage],
  ['/onay', OnayPage, { token: MOCK_WEB_TOKEN }],
  ['/giris', GirisPage],
] as const;

async function selectQueueItem(container: HTMLElement, key: string) {
  const btn = await waitFor(() => {
    const b = container.querySelector<HTMLButtonElement>(`[data-queue-key="${key}"]`);
    if (!b) throw new Error(`kuyrukta yok: ${key}`);
    return b;
  });
  fireEvent.click(btn);
  await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'));
  await waitFor(() => expect(container.querySelectorAll('[aria-busy="true"]').length).toBe(0));
}

describe('ders raporları', () => {
  it('lesson_draft_shows_onay_bekliyor', async () => {
    const list = await renderPage(DerslerPage, { role: 'instructor', path: '/dersler' });
    const notice = list.container.querySelector('.og-notice-warning');
    expect(notice?.textContent).toContain('Onay bekliyor');
    list.unmount();

    const detail = await renderPage(DersPage, { role: 'instructor', path: '/ders', query: { id: ANALYSIS_ID } });
    const warn = detail.container.querySelector('.og-notice-warning');
    expect(warn?.querySelector('.og-notice-title')?.textContent).toBe('Onay bekliyor');
    expect(detail.container.textContent).toContain('Ders analizi: 0,41 $ (ayrı bütçe)');
    expect(detail.container.textContent).toContain('Konuşma oranı %42');
    expect(detail.container.textContent).toContain('Moral orta');
    expect(detail.container.querySelectorAll('.og-evidence').length).toBeGreaterThanOrEqual(8);
    expect(detail.container.textContent).toContain('Ders 19 Eki · 00:06');
    // claim kanıtı olan ustalık yüzdesiz (öğrencide 0 gözlem)
    expect(detail.container.textContent).toContain('Henüz yeterli kanıt yok');
  });

  it('approving a lesson writes decisions and removes the draft notice', async () => {
    const { container } = await renderPage(DersPage, { role: 'instructor', path: '/ders', query: { id: ANALYSIS_ID } });
    const reject = buttonsNamed(container, /^Reddet$/)[0];
    fireEvent.click(reject);
    expect(container.textContent).toContain('✕ Reddedilecek');
    const [primary] = [...container.querySelectorAll<HTMLButtonElement>('.og-btn-primary')];
    expect(primary.textContent).toBe('Onayla');
    // karar verilmemiş madde varken tek "Onayla" kapalı; sayaç kalanları söyler (madde başına açık karar, §7)
    expect(primary.disabled).toBe(true);
    expect(container.textContent).toMatch(/\d+ madde karar bekliyor/);
    fireEvent.click(primary);
    expect(container.textContent).not.toContain('Rapor onaylandı');
    // kalanlar bilerek onaylanır; reddedilen madde reddedilmiş kalır
    fireEvent.click(buttonsNamed(container, /^Kalanların hepsini onayla$/)[0]);
    expect(container.textContent).not.toMatch(/madde karar bekliyor/);
    expect(container.textContent).toContain('✕ Reddedilecek');
    expect(primary.disabled).toBe(false);
    fireEvent.click(primary);
    // ilk "Reddet" konuşma (talk) claim'idir; question/hesitation/next_step profile işlenmez → 2 ustalık + 2 yanılgı + 1 ödev = 5
    await within(container).findByText(/Rapor onaylandı; 5 madde öğrenci profiline işlendi\./);
    expect(container.querySelector('.og-notice-warning')).toBeNull();
  });

  it('role switch keeps the other query parameters', async () => {
    const { container } = await renderPage(DersPage, { role: 'coordinator', path: '/ders', query: { id: ANALYSIS_ID } });
    const links = [...container.querySelectorAll<HTMLAnchorElement>('.mock-role-link')];
    expect(links).toHaveLength(3);
    for (const a of links) {
      const q = new URLSearchParams(a.getAttribute('href')!.replace(/^\?/, ''));
      expect(q.get('id')).toBe(ANALYSIS_ID);
      expect(['coordinator', 'instructor', 'observer']).toContain(q.get('role'));
    }
  });
});

describe('roller', () => {
  it('observer_has_no_enabled_approve_button', async () => {
    const cases: [string, React.ComponentType, Record<string, string>?][] = [
      ['/ders', DersPage, { id: ANALYSIS_ID }],
      ['/kuyruk', KuyrukPage],
      ['/oncelik', OncelikPage],
    ];
    let seen = 0;
    for (const [path, Page, query] of cases) {
      const { container, unmount } = await renderPage(Page, { role: 'observer', path, query });
      if (path === '/kuyruk') {
        for (const b of [...container.querySelectorAll<HTMLButtonElement>('[data-queue-key]')]) {
          fireEvent.click(b);
          await waitFor(() => expect(container.querySelectorAll('[aria-busy="true"]').length).toBe(0));
          const approve = buttonsNamed(container, /^Onayla/);
          seen += approve.length;
          expect(approve.filter((x) => !x.disabled)).toEqual([]);
        }
      } else {
        const approve = buttonsNamed(container, /^Onayla/);
        expect(approve.length).toBeGreaterThan(0);
        seen += approve.length;
        expect(approve.filter((x) => !x.disabled)).toEqual([]);
      }
      unmount();
    }
    expect(seen).toBeGreaterThan(5);
  });

  it('observer sees only assigned students and no raw text', async () => {
    const { container } = await renderPage(OgrencilerPage, { role: 'observer', path: '/ogrenciler' });
    const labels = [...container.querySelectorAll('[data-student-label]')].map((a) => a.textContent);
    expect(labels).toEqual(['Elif K.']);
  });

  it('coordinator-only pages tell other roles', async () => {
    const { container } = await renderPage(MaliyetPage, { role: 'instructor', path: '/maliyet' });
    expect(container.textContent).toContain('Bu sayfa yalnız koordinatör içindir.');
    expect(container.textContent).not.toContain('$');
  });
});

describe('maliyet ve öğrenci adları', () => {
  it('cost_only_in_review_row', async () => {
    const costRe = /\d\s?\$/;
    for (const [path, Page, query] of ALL_PAGES) {
      const { container, unmount } = await renderPage(Page as React.ComponentType, { role: 'coordinator', path, query: query as Record<string, string> | undefined });
      const text = container.textContent ?? '';
      if (path === '/cevaplar') {
        const reviews = [...container.querySelectorAll('.og-msg-review')];
        expect(reviews.length).toBeGreaterThan(0);
        expect(reviews.every((r) => costRe.test(r.textContent ?? ''))).toBe(true);
        // review satırları dışında maliyet yok
        const clone = container.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.og-msg-review, details').forEach((n) => n.remove());
        expect(costRe.test(clone.textContent ?? '')).toBe(false);
      } else if (path === '/maliyet' || path === '/ders') {
        expect(costRe.test(text)).toBe(true);
      } else {
        expect([path, costRe.test(text)]).toEqual([path, false]);
      }
      unmount();
    }
  });

  it('student_label_is_initial_only', async () => {
    const labelRe = /^\p{L}+ \p{Lu}\.$/u;
    for (const [path, Page, query] of ALL_PAGES) {
      const { container, unmount } = await renderPage(Page as React.ComponentType, { role: 'coordinator', path, query: query as Record<string, string> | undefined });
      const text = container.textContent ?? '';
      for (const n of FULL_NAMES) expect([path, text.includes(n)]).toEqual([path, false]);
      unmount();
    }
    const { container } = await renderPage(OgrencilerPage, { role: 'coordinator', path: '/ogrenciler' });
    const labels = [...container.querySelectorAll('[data-student-label]')].map((a) => a.textContent ?? '');
    expect(labels).toEqual(['Elif K.', 'Mert D.', 'Zeynep Ç.']);
    expect(labels.every((l) => labelRe.test(l))).toBe(true);
  });

  it('full name only via audited student_full_name for the coordinator', async () => {
    const { container } = await renderPage(OnaylarPage, { role: 'coordinator', path: '/onaylar' });
    const select = container.querySelector<HTMLSelectElement>('#pii-student')!;
    fireEvent.change(select, { target: { value: 's_qk7m2rx4tn5a' } });
    fireEvent.click(buttonsNamed(container, /^Tam adı göster$/)[0]);
    await within(container).findByText('Elif Kaya');
    expect(container.textContent).toContain('Görüntüleme denetim kaydına yazılır.');
  });

  it('rendered text: no exclamation marks, no emoji, no forecast words', async () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]/u;
    for (const [path, Page, query] of ALL_PAGES) {
      const { container, unmount } = await renderPage(Page as React.ComponentType, { role: 'coordinator', path, query: query as Record<string, string> | undefined });
      const clone = container.cloneNode(true) as HTMLElement;
      // fixture'dan gelen ham öğrenci mesajları ve prompt metinleri ürün metni değildir
      clone.querySelectorAll('.og-msg-student, details, .legal-body').forEach((n) => n.remove());
      const text = clone.textContent ?? '';
      expect([path, text.includes('!')]).toEqual([path, false]);
      expect([path, emoji.test(text)]).toEqual([path, false]);
      expect([path, /\b(tahmin|çıkacak|garanti)\b/i.test(text)]).toEqual([path, false]);
      unmount();
    }
  });

  it('primary_button_at_most_one_per_page (rendered)', async () => {
    for (const [path, Page, query] of ALL_PAGES) {
      for (const role of ['coordinator', 'instructor', 'observer'] as const) {
        const { container, unmount } = await renderPage(Page as React.ComponentType, { role, path, query: query as Record<string, string> | undefined });
        expect([path, role, primaryCount(container) <= 1]).toEqual([path, role, true]);
        unmount();
      }
    }
  });
});

describe('onay kuyruğu', () => {
  it('approve_disabled_until_key_peeked', async () => {
    const { container } = await renderPage(KuyrukPage, { role: 'instructor', path: '/kuyruk' });
    await selectQueueItem(container, SOZEL_QUESTION);
    const approve = () => container.querySelector<HTMLButtonElement>('.og-btn-primary')!;
    expect(approve().textContent).toBe('Onayla');
    expect(approve().disabled).toBe(true);
    expect(container.textContent).toContain('Önce cevap anahtarını gör');
    expect(container.textContent).toContain('Anahtarı görmek denetim kaydına yazılır.');
    fireEvent.click(buttonsNamed(container, /^Cevap anahtarını göster$/)[0]);
    await waitFor(() => expect(approve().disabled).toBe(false));
    expect(container.textContent).toContain('Doğru şık: B');
    fireEvent.click(approve());
    await within(container).findByText('Onaylandı.');
    expect(container.querySelector(`[data-queue-key="${SOZEL_QUESTION}"]`)).toBeNull();
  });

  it('misconception "Onayla" confirms the suspicion (open), it does not resolve it', async () => {
    const { container } = await renderPage(KuyrukPage, { role: 'instructor', path: '/kuyruk' });
    const key = [...container.querySelectorAll('[data-queue-key^="misconception:275a73df"]')][0]!.getAttribute('data-queue-key')!;
    await selectQueueItem(container, key);
    const approve = container.querySelector<HTMLButtonElement>('.og-btn-primary')!;
    expect(approve.textContent).toBe('Onayla');
    expect(container.textContent).toContain('Onay yanılgıyı açık yanılgı yapar');
    expect(container.textContent).not.toContain('Çözüldü');
    fireEvent.click(approve);
    await within(container).findByText('Onaylandı.');
    expect(container.querySelector(`[data-queue-key="${key}"]`)).toBeNull();
  });

  it('verified-key question can be approved without peeking', async () => {
    const { container } = await renderPage(KuyrukPage, { role: 'instructor', path: '/kuyruk' });
    await selectQueueItem(container, 'question:3287fc04-ca60-5ed1-96c1-a35c6740d5fa');
    expect(container.querySelector<HTMLButtonElement>('.og-btn-primary')!.disabled).toBe(false);
  });

  it('citation_relevance_only_instructor', async () => {
    for (const [role, disabled] of [
      ['observer', true],
      ['instructor', false],
    ] as const) {
      const { container, unmount } = await renderPage(KuyrukPage, { role, path: '/kuyruk' });
      await selectQueueItem(container, RESEARCH);
      const selects = [...container.querySelectorAll<HTMLSelectElement>('select[id^="rel-"]')];
      expect(selects).toHaveLength(4);
      expect(selects.every((s) => s.disabled === disabled)).toBe(true);
      expect(container.querySelectorAll('.og-cite').length).toBe(4);
      if (!disabled) {
        fireEvent.change(selects[0], { target: { value: '2' } });
        await waitFor(() => expect(selects[0].value).toBe('2'));
      }
      unmount();
    }
  });

  it('priority plan item lists rows with the frequency title', async () => {
    const { container } = await renderPage(KuyrukPage, { role: 'instructor', path: '/kuyruk' });
    await selectQueueItem(container, 'priority_plan:e0cc9cfb-fffd-5244-8eaf-45e360ce3381');
    expect(container.textContent).toContain('Sıklık analizine göre öncelikler');
    expect(container.querySelectorAll('.og-exam').length).toBe(5);
    expect(/tahmin|çıkacak|kesin|garanti/i.test(container.textContent ?? '')).toBe(false);
  });
});

describe('öncelikler', () => {
  it('approving a plan keeps a single approved plan per course', async () => {
    const { container } = await renderPage(OncelikPage, { role: 'instructor', path: '/oncelik', query: { course: 'TYT-MAT' } });
    expect(container.textContent).toContain('Sıklık analizine göre öncelikler');
    fireEvent.click(container.querySelector<HTMLButtonElement>('.og-btn-primary')!);
    await within(container).findByText(/Plan onaylandı/);
    const badges = [...container.querySelectorAll('.list-btn .og-badge')].map((b) => b.textContent);
    expect(badges.filter((b) => b === '✓ Onaylı')).toHaveLength(1);
    expect(badges.filter((b) => b === 'Geri çekildi')).toHaveLength(2);
  });

  it('archive upload needs a legal basis and a hoca-X alias', async () => {
    const { container } = await renderPage(OncelikPage, { role: 'instructor', path: '/oncelik' });
    const submit = buttonsNamed(container, /^Arşivi yükle$/)[0];
    const file = new File(['%PDF-1.4'], 'vize.pdf', { type: 'application/pdf' });
    fireEvent.change(container.querySelector('#exam-file')!, { target: { files: [file] } });
    const fields = [...container.querySelectorAll<HTMLInputElement>('input.og-field-input')];
    const year = fields.find((f) => f.labels?.[0]?.textContent === 'Yıl')!;
    const alias = fields.find((f) => f.labels?.[0]?.textContent === 'Eğitmen takma adı')!;
    fireEvent.change(year, { target: { value: '2024' } });
    fireEvent.change(container.querySelector('#exam-term')!, { target: { value: 'vize' } });
    fireEvent.change(alias, { target: { value: 'Ayşe Yılmaz' } });
    expect(submit.disabled).toBe(true);
    expect(container.textContent).toContain('gerçek ad girilmez');
    fireEvent.change(alias, { target: { value: 'hoca-B' } });
    expect(submit.disabled).toBe(true); // hukuki dayanak seçilmedi
    fireEvent.change(container.querySelector('#exam-basis')!, { target: { value: 'eğitmenin kendi sınavı' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await within(container).findByText(/OCR gece işinde/);
    await waitFor(() => expect(container.textContent).toContain('hoca-B'));
  });
});

describe('veli onay formu', () => {
  it('consent_page_no_prechecked_box', async () => {
    const { container } = await renderPage(OnayPage, { path: '/onay', query: { token: MOCK_WEB_TOKEN } });
    const boxes = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes.length).toBe(3);
    expect(boxes.every((b) => !b.checked && !b.defaultChecked && !b.hasAttribute('checked'))).toBe(true);
    expect(container.querySelector('select')?.value).toBe('');
    const primary = container.querySelectorAll<HTMLButtonElement>('.og-btn-primary');
    expect(primary).toHaveLength(1);
    expect(primary[0].textContent).toBe('Onaylıyorum');
    expect(primary[0].disabled).toBe(true);
    expect(buttonsNamed(container, /^Şimdi değil$/)[0].className).toContain('og-btn-quiet');
    expect(container.querySelector('h1')?.className).toContain('t-title-3');
    expect(container.querySelector('.og-notice-legal')).not.toBeNull();
    expect(/[!]/.test(container.textContent ?? '')).toBe(false);
  });

  it('shows the versioned form text with retention days and the full aydınlatma metni', async () => {
    const { container } = await renderPage(OnayPage, { path: '/onay', query: { token: MOCK_WEB_TOKEN } });
    const text = container.textContent ?? '';
    expect(container.querySelector('[data-doc-version]')?.getAttribute('data-doc-version')).toBe('2026-10-v1');
    expect(text).toContain('Metin sürümü 2026-10-v1');
    expect(text).toContain('mesajları kaydedilir ve 90 gün sonra silinir');
    expect(text).not.toContain('{{');
    expect(text).not.toMatch(/saklama süresi sonunda silinir/);
    // aydınlatma metni sayfada açılır (beyan 1 "Aydınlatma metnini okudum" der)
    const details = container.querySelector('details.legal-details')!;
    expect(details.querySelector('summary')?.textContent).toContain('Aydınlatma metninin tamamı');
    expect(details.textContent).toContain('Kişisel Verilerin İşlenmesine İlişkin Aydınlatma Metni');
    expect(details.querySelectorAll('table').length).toBeGreaterThan(0);
    // beyan metinleri formun 5. bölümünden: 1, 2, 4 (3 yalnız kâğıt formda)
    const labels = [...container.querySelectorAll('label.check')].map((l) => l.textContent ?? '');
    expect(labels).toHaveLength(3);
    expect(labels[0]).toMatch(/^Aydınlatma metnini okudum/);
    expect(labels[1]).toContain('Gemini ücretsiz katmanının');
    expect(labels[2]).toMatch(/^Onayımı istediğim zaman geri alabileceğimi/);
    expect(labels.join(' ')).not.toContain('(zorunlu');
  });

  it('redeems a web token once', async () => {
    const { container } = await renderPage(OnayPage, { path: '/onay', query: { token: MOCK_WEB_TOKEN } });
    fireEvent.change(container.querySelector('input.og-field-input')!, { target: { value: 'Ayten Çelik' } });
    fireEvent.change(container.querySelector('#relation')!, { target: { value: 'anne' } });
    const primary = container.querySelector<HTMLButtonElement>('.og-btn-primary')!;
    for (const b of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
      expect(primary.disabled).toBe(true);
      fireEvent.click(b);
    }
    expect(primary.disabled).toBe(false);
    fireEvent.click(primary);
    await within(container).findByText('Onayınız kaydedildi');
  });

  it('declining writes nothing; invalid token is reported', async () => {
    const decline = await renderPage(OnayPage, { path: '/onay', query: { token: MOCK_WEB_TOKEN } });
    fireEvent.click(buttonsNamed(decline.container, /^Şimdi değil$/)[0]);
    await within(decline.container).findByText('Onay verilmedi');
    decline.unmount();
    const bad = await renderPage(OnayPage, { path: '/onay', query: { token: 'AAAA-BBBB' } });
    fireEvent.change(bad.container.querySelector('input.og-field-input')!, { target: { value: 'Ayten Çelik' } });
    fireEvent.change(bad.container.querySelector('#relation')!, { target: { value: 'anne' } });
    bad.container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach((b) => fireEvent.click(b));
    fireEvent.click(bad.container.querySelector<HTMLButtonElement>('.og-btn-primary')!);
    await within(bad.container).findByText('Bağlantı geçersiz');
  });
});

describe('öğrenci profili', () => {
  it('mastery_hides_percent_below_min_evidence', async () => {
    const { container } = await renderPage(OgrenciPage, { role: 'instructor', path: '/ogrenci', query: { ref: 's_vd3hp6wz2kc7' } });
    const meters = [...container.querySelectorAll('.og-mastery')];
    const students = readJson<{ public_ref: string; mastery: { skill_name: string; evidence_count: number; p: number }[] }[]>('fixtures/panel/students.json');
    const mert = students.find((s) => s.public_ref === 's_vd3hp6wz2kc7')!;
    expect(meters).toHaveLength(mert.mastery.length);
    for (const m of mert.mastery) {
      const el = meters.find((x) => x.querySelector('.og-mastery-skill')?.textContent === m.skill_name)!;
      const value = el.querySelector('.og-mastery-value')?.textContent;
      if (m.evidence_count < 5) {
        expect(value).toBe('Henüz yeterli kanıt yok');
        expect(el.querySelector('.og-mastery-fill')).toBeNull();
      } else {
        expect(value).toBe(`%${Math.round(m.p * 100)}`);
      }
    }
    expect(container.textContent).toContain('%41');
    expect(container.textContent).toContain('YKS 2027');
    expect(container.querySelectorAll('.og-miscon .og-evidence').length).toBeGreaterThan(0);
  });

  it('observer cannot add a note (form disabled)', async () => {
    const { container } = await renderPage(OgrenciPage, { role: 'observer', path: '/ogrenci', query: { ref: 's_qk7m2rx4tn5a' } });
    expect(container.querySelector<HTMLTextAreaElement>('#note-body')!.disabled).toBe(true);
    expect(buttonsNamed(container, /^Notu ekle$/)[0].disabled).toBe(true);
  });
});

describe('gruplar ve maliyet', () => {
  it('group settings refuse an empty or out-of-range retention value', async () => {
    const { container } = await renderPage(GruplarPage, { role: 'coordinator', path: '/gruplar' });
    const days = container.querySelector<HTMLInputElement>('input[id^="days-"]')!;
    expect(days.required).toBe(true);
    const before = days.value;
    fireEvent.change(days, { target: { value: '' } });
    fireEvent.submit(days.closest('form')!);
    await within(container).findByText('Saklama günü 1–365 arasında olmalı.');
    fireEvent.change(days, { target: { value: '0' } });
    fireEvent.submit(days.closest('form')!);
    await within(container).findByText('Saklama günü 1–365 arasında olmalı.');
    expect(container.textContent).not.toContain('Kaydedildi.');
    fireEvent.change(days, { target: { value: before } });
    fireEvent.submit(days.closest('form')!);
    await within(container).findByText(/^Kaydedildi\./);
  });

  it('group page warns when the bot is not admin', async () => {
    const { container } = await renderPage(GruplarPage, { role: 'coordinator', path: '/gruplar' });
    const fx = readJson<{ bot_is_admin: boolean }[]>('fixtures/panel/chats.json');
    expect(container.querySelectorAll('.og-notice-warning').length).toBe(fx.filter((c) => !c.bot_is_admin).length);
    expect(container.textContent).toContain('Bot yönetici değil');
    fireEvent.change(container.querySelector('#link-staff')!, { target: { value: 'de70e65e-1410-5026-a773-c5e55a3e6368' } });
    fireEvent.click(buttonsNamed(container, /^Bağlama kodu üret$/)[0]);
    await within(container).findByText(/^Bağlama kodu: [A-Z2-7]{4}-[A-Z2-7]{4}$/);
    expect(container.textContent).toContain('/egitmen');
  });

  it('cost page separates lesson analysis and shows the pilot gate', async () => {
    const { container } = await renderPage(MaliyetPage, { role: 'coordinator', path: '/maliyet' });
    const head = [...container.querySelectorAll('th')].map((t) => t.textContent);
    expect(head).toContain('Sohbet ve toplu işler');
    expect(head).toContain('Ders analizi');
    const gate = container.querySelector('[data-testid="pilot-gate"]')!;
    expect(gate.querySelector('[data-gate]')?.textContent).toBe('Kapı: KAPALI');
    expect(gate.querySelector('[data-metric="question_accuracy"]')?.getAttribute('data-verdict')).toBe('NO_DATA');
    expect(gate.querySelector('[data-metric="citation_relevance"]')?.textContent).toContain('bilgi');
    expect(container.textContent).toContain('henüz ölçülmedi');
    // ders analizi ay toplamı 0,25 $; sohbet tavanını etkilemez
    expect(container.textContent).toContain('0,25 $');
    fireEvent.click(buttonsNamed(container, /^Ücretli modeli kapat$/)[0]);
    await within(container).findByText('Ücretli modeli yeniden aç');
    expect(container.textContent).toContain('Yalnız ücretsiz katman');
  });

  it('pilot gate block shows a visible error and stays KAPALI on malformed settings.pilot_gate', () => {
    loadDs();
    const period = '2026-10-19';
    const metrics = [{ metric: 'degraded_share', period, value: 0.01, detail: { n: 40 }, computed_at: period }];
    const { container } = render(<GateBlock gate={evaluatePilotGate({ degraded_share: { max: '0.05' } }, metrics)} />);
    const gate = container.querySelector('[data-testid="pilot-gate"]')!;
    expect(gate.querySelector('[data-gate]')?.textContent).toBe('Kapı: KAPALI');
    expect(gate.querySelector('[data-testid="pilot-gate-error"]')?.textContent).toContain('OGR-KLK-020 settings.pilot_gate.degraded_share.max sayı olmalı');
    expect(gate.querySelector('[data-verdict="PASS"]')).toBeNull();
  });
});
