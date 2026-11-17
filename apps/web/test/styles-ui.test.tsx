// Tarz kütüphanesi ekranları: kartlar (sıklık "x/y yıl", kapsama cümlesi), süzgeç/sıralama, düzenle, birleştir, "5 soru üret",
// öncelik bloğu (ExamPriorityRow, onay), çıkmış sınav yükleme formu ve Gelişim satırı.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh }), usePathname: () => '/egitmen/soru-tarzlari' }));
vi.mock('@/lib/live', () => ({ useLive: () => null }));
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowserClient: () => ({ storage: { from: () => ({ upload: vi.fn(async () => ({ error: null })) }) } }) }));
vi.mock('@/app/ogrenci/yukle/gorsel', async () => ({
  newUploadId: (() => {
    let n = 0;
    return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  })(),
  preparePage: async (f: File) => ({ blob: f, mime: f.type === 'application/pdf' ? 'application/pdf' : 'image/jpeg', bytes: f.size, width: null, height: null, sha256: null }),
  PrepareError: class extends Error {},
}));

import { ArchiveUpload } from '@/components/styles/ArchiveUpload';
import { PriorityBlock } from '@/components/styles/PriorityBlock';
import { StyleLibrary, type StyleActions } from '@/components/styles/StyleLibrary';
import { StyleCoverageLine } from '@/app/ogrenci/gelisim/tarz';
import { parseLibrary, type LibraryStyle } from '@/server/styles/shared';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ok = (message = 'Tamam') => vi.fn(async () => ({ ok: true, message }));

function style(n: number, over: Record<string, unknown> = {}): LibraryStyle {
  const v = parseLibrary({
    role: 'staff',
    can_manage: true,
    course: { id: U(1), code: 'C', title: 'TYT Matematik' },
    archive: { years_from: 2018, years_to: 2025, years_total: 8, sources: 8, items: 10, styled_items: 10, pending_sources: 0, last_clustered_at: null },
    plan: null,
    styles: [
      {
        id: U(n), code: `T-${n}`, name: `Tarz ${n}`, description: 'Eşitsizlikte aralık sorar.', format: 'çoktan seçmeli', trick: 'Uç noktalar', difficulty_band: 'mid', status: 'active', source: 'instructor',
        reviewed_at: '2025-10-01T00:00:00Z', skills: [{ id: 'a.b', name: 'Mutlak değer' }], years_hit: [2025, 2024, 2023, 2021, 2019, 2018, 2022], years_total: 8, last_year: 2025,
        frequency: 0.88, recency: 1, alignment: 0.85, score: 0.91, appearances: [{ item_id: U(100 + n), year: 2025, term: 'osym', item_no: 12 }],
        coverage: { students_total: 12, students_solved: 7, solved: 24, correct: 17, unsolved: [{ enrollment_id: U(200), display_name: 'Mert A.' }] },
        ...over,
      },
    ],
  });
  return v.styles[0]!;
}

function actions(over: Partial<StyleActions> = {}): StyleActions {
  return { save: ok('Kaydedildi.'), add: ok('Tarz eklendi.'), merge: ok('Birleştirildi.'), generate: ok('5 soru üretmeye başladım'), ...over } as StyleActions;
}

describe('StyleLibrary', () => {
  const styles = [style(1), style(2, { name: 'Karışım problemi', status: 'draft', reviewed_at: null, score: 0.5 })];

  it('kart: ad, tanım, "7/8 yıl", güncellik, kazanım çipi, kapsama cümlesi; yüzde yok', () => {
    render(<StyleLibrary courseId={U(1)} styles={styles} canManage pendingSources={0} actions={actions()} />);
    const card = screen.getByTestId('tarz-T-1');
    expect(within(card).getByRole('heading', { name: 'Tarz 1' })).toBeInTheDocument();
    expect(card).toHaveTextContent('7/8 yıl');
    expect(card).toHaveTextContent('son 2025 · 5 yıl üst üste');
    expect(card).toHaveTextContent('12 öğrenciden 7 kişi çözdü');
    expect(within(card).getByRole('list', { name: 'Kazanımlar' })).toHaveTextContent('Mutlak değer');
    expect(card.textContent).not.toMatch(/%/);
    expect(screen.getByTestId('tarz-T-2')).toHaveTextContent('Adı onay bekliyor');
  });

  it('"Adlandırma bekliyor" süzgeci yalnız onaysız tarzı bırakır', async () => {
    const user = userEvent.setup();
    render(<StyleLibrary courseId={U(1)} styles={styles} canManage pendingSources={0} actions={actions()} />);
    await user.click(screen.getByRole('button', { name: /Adlandırma bekliyor/ }));
    expect(screen.queryByTestId('tarz-T-1')).toBeNull();
    expect(screen.getByTestId('tarz-T-2')).toBeInTheDocument();
  });

  it('"5 soru üret" ve Düzenle → Kaydet doğru girdiyle çağrılır', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<StyleLibrary courseId={U(1)} styles={styles} canManage pendingSources={0} actions={a} />);
    const card = screen.getByTestId('tarz-T-1');
    await user.click(within(card).getByRole('button', { name: '5 soru üret' }));
    await waitFor(() => expect(a.generate).toHaveBeenCalledWith(U(1), 5));
    expect(await screen.findByText(/5 soru üretmeye başladım/)).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: 'Düzenle' }));
    const name = within(card).getByLabelText('Tarz adı');
    await user.clear(name);
    await user.type(name, 'Mutlak değerli eşitsizlik');
    await user.click(within(card).getByRole('button', { name: 'Kaydet' }));
    await waitFor(() => expect(a.save).toHaveBeenCalledWith({ courseId: U(1), code: 'T-1', name: 'Mutlak değerli eşitsizlik', description: 'Eşitsizlikte aralık sorar.' }));
    expect(refresh).toHaveBeenCalled();
  });

  it('Birleştir: seçilen tarza katılır (keep = hedef, merge = bu kart)', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<StyleLibrary courseId={U(1)} styles={styles} canManage pendingSources={0} actions={a} />);
    const card = screen.getByTestId('tarz-T-2');
    await user.click(within(card).getByRole('button', { name: 'Birleştir' }));
    await user.selectOptions(within(card).getByLabelText('Bu tarzı şuna kat'), U(1));
    await user.click(within(card).getByRole('button', { name: 'Birleştir' }));
    await waitFor(() => expect(a.merge).toHaveBeenCalledWith(U(1), U(2)));
  });

  it('Tarz ekle: ad girilince Ekle açılır', async () => {
    const user = userEvent.setup();
    const a = actions();
    render(<StyleLibrary courseId={U(1)} styles={styles} canManage pendingSources={0} actions={a} />);
    await user.click(screen.getByRole('button', { name: 'Tarz ekle' }));
    const add = screen.getByRole('button', { name: 'Ekle' });
    expect(add).toBeDisabled();
    await user.type(screen.getByLabelText('Yeni tarzın adı'), 'Basamak çözümleme');
    await user.click(add);
    await waitFor(() => expect(a.add).toHaveBeenCalledWith({ courseId: U(1), name: 'Basamak çözümleme', description: '' }));
  });

  it('yazma yetkisi yoksa eylem düğmeleri yok; ayrıntıda hiç çözmeyen öğrenci adı', () => {
    render(<StyleLibrary courseId={U(1)} styles={styles} canManage={false} pendingSources={2} actions={actions()} />);
    expect(screen.queryByRole('button', { name: '5 soru üret' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tarz ekle' })).toBeNull();
    expect(screen.getByText(/2 sınav tarzlara ayrılıyor/)).toBeInTheDocument();
    expect(screen.getByTestId('tarz-T-1')).toHaveTextContent('Mert A.');
  });
});

describe('PriorityBlock', () => {
  const s = style(1);
  const plan = (status: 'pending_review' | 'approved') => ({
    id: U(9), status, period: '2022–2025', created_at: '2025-11-01T00:00:00Z', approved_at: null,
    plan: { rows: [{ rank: 1, topic: 'Tarz 1', kind: 'çoktan seçmeli', hits: 7, years: 8, points_text: '≈10 puan', evidence_count: 7, style_ids: [U(1)] }], others: [], uncovered_topics: [] },
  });

  it('başlık sabit; satırda "7/8 yıl", kanıt ve skor; bekleyen planı onaylar', async () => {
    const user = userEvent.setup();
    const decide = ok('Onaylandı.');
    const p = plan('pending_review');
    render(<PriorityBlock courseId={U(1)} plan={p as never} styles={[s]} canManage yearsTotal={8} compute={ok()} decide={decide} />);
    const block = screen.getByTestId('oncelikler');
    expect(within(block).getByRole('heading', { name: 'Sıklık analizine göre öncelikler' })).toBeInTheDocument();
    expect(block).toHaveTextContent('7/8 yıl');
    expect(block).toHaveTextContent('Kanıt: 7 soru · son 2025');
    expect(block).toHaveTextContent('Skor 0,91');
    expect(block).toHaveTextContent('Onayını bekliyor');
    expect(block.textContent).not.toMatch(/tahmin|çıkacak|kesin/i);
    await user.click(screen.getByRole('button', { name: /^Onayla$/ }));
    await waitFor(() => expect(decide).toHaveBeenCalledWith(U(9), 'approved'));
  });

  it('plan yokken: iki yıldan az arşivde hesaplama kapalı ve açıklama; yeterliyse "Önceliği hesapla"', async () => {
    const user = userEvent.setup();
    const compute = ok();
    const { rerender } = render(<PriorityBlock courseId={U(1)} plan={null} styles={[]} canManage yearsTotal={1} compute={compute} decide={ok()} />);
    expect(screen.getByTestId('oncelik-bos')).toHaveTextContent('en az iki yılın');
    expect(screen.getByRole('button', { name: 'Önceliği hesapla' })).toBeDisabled();
    rerender(<PriorityBlock courseId={U(1)} plan={null} styles={[]} canManage yearsTotal={4} compute={compute} decide={ok()} />);
    await user.click(screen.getByRole('button', { name: 'Önceliği hesapla' }));
    await waitFor(() => expect(compute).toHaveBeenCalledWith(U(1)));
  });
});

describe('ArchiveUpload', () => {
  it('yıl + tür + dosyalar → ingest çağrısı (yol eğitmenin klasöründe)', async () => {
    const user = userEvent.setup();
    const ingest = vi.fn(async (_i: unknown) => ({ ok: true, message: '2024 sınavını aldım; tarzlara ayırıyorum.' }));
    const owner = U(50);
    render(<ArchiveUpload courseId={U(1)} ownerId={owner} ingest={ingest} />);
    const send = screen.getByRole('button', { name: 'Yükle' });
    expect(send).toBeDisabled();
    await user.clear(screen.getByLabelText('Sınav yılı'));
    await user.type(screen.getByLabelText('Sınav yılı'), '2024');
    await user.selectOptions(screen.getByLabelText('Sınav türü'), 'meb');
    await user.upload(screen.getByTestId('arsiv-dosya'), [new File(['%PDF'], 'tyt-2024.pdf', { type: 'application/pdf' }), new File(['x'], 's2.jpg', { type: 'image/jpeg' })]);
    expect(screen.getByRole('list', { name: 'Seçilen dosyalar' })).toHaveTextContent('tyt-2024.pdf');
    await user.click(screen.getByRole('button', { name: 'Yükle' }));
    await waitFor(() => expect(ingest).toHaveBeenCalledTimes(1));
    const arg = ingest.mock.calls[0]![0] as { courseId: string; year: number; term: string; files: Array<{ path: string; mime: string }> };
    expect(arg).toMatchObject({ courseId: U(1), year: 2024, term: 'meb' });
    expect(arg.files).toHaveLength(2);
    expect(arg.files[0]!.path.startsWith(`${owner}/`)).toBe(true);
    expect(arg.files.map((f) => f.mime)).toEqual(['application/pdf', 'image/jpeg']);
    expect(await screen.findByText(/2024 sınavını aldım/)).toBeInTheDocument();
  });
});

describe('Gelişim tarz satırı', () => {
  it('"Tarz: 2/5 çözdün"; açılınca kapsama cümleleri; tarz yoksa hiçbir şey', () => {
    const summary = {
      styles: 5, never_solved: 3,
      rows: [{ styleId: 'a', name: 'Karışım problemi', text: '3 çözdün, 1 doğru' }, { styleId: 'b', name: 'Oran-orantı', text: 'Bu tarzı hiç çözmedin' }],
    };
    const { rerender } = render(<StyleCoverageLine summary={summary} />);
    const row = screen.getByTestId('tarz-satiri');
    expect(row).toHaveTextContent('Tarz: 2/5 çözdün');
    expect(row).toHaveTextContent('3 çözdün, 1 doğru');
    expect(row.textContent).not.toMatch(/%/);
    rerender(<StyleCoverageLine summary={{ styles: 0, never_solved: 0, rows: [] }} />);
    expect(screen.queryByTestId('tarz-satiri')).toBeNull();
    rerender(<StyleCoverageLine summary={null} />);
    expect(screen.queryByTestId('tarz-satiri')).toBeNull();
  });
});
