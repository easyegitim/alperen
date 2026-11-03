import fs from 'node:fs';
import path from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
// DraftProgress'in Realtime kanalı: subscribe geri çağrısı testten sürülür
const realtime = vi.hoisted(() => {
  const state: { cb: ((s: string) => void) | null } = { cb: null };
  const channel = { on: () => channel, subscribe: (f: (s: string) => void) => ((state.cb = f), channel), unsubscribe: () => undefined };
  return { state, channel };
});
vi.mock('@/lib/supabase/browser', () => ({ createSupabaseBrowserClient: () => ({ channel: () => realtime.channel, removeChannel: async () => 'ok' }) }));

import { DraftProgress } from '@/components/curriculum/DraftProgress';
import { LIVE_DEFAULTS } from '@/lib/live';
import { EditorActions } from '@/components/curriculum/EditorActions';
import { ProposalsBox } from '@/components/curriculum/ProposalsBox';
import { TreeEditor, type TreeChange } from '@/components/curriculum/TreeEditor';
import {
  buildTree,
  confidenceBand,
  curriculumErrorMessage,
  isUuid,
  mergeTargets,
  moveTargets,
  proposalHeadline,
  subtreeSummary,
  type SkillRow,
} from '@/lib/curriculum-tree';

// Küçük ağaç: kök → 2 ünite; u1 → k1 (2 alt), k2; u2 → k3
const ROWS: SkillRow[] = [
  { id: 'r', parent_id: null, name: 'Kimya', kind: 'unit', is_leaf: false, order_no: 0 },
  { id: 'r.u2', parent_id: 'r', name: 'Bağlar', kind: 'unit', is_leaf: false, order_no: 20 },
  { id: 'r.u1', parent_id: 'r', name: 'Atom', kind: 'unit', is_leaf: false, order_no: 10 },
  { id: 'r.u1.k1', parent_id: 'r.u1', name: 'Atom modelleri', kind: 'outcome', is_leaf: false, order_no: 11 },
  { id: 'r.u1.k1.a', parent_id: 'r.u1.k1', name: 'Bohr modeli', kind: 'sub_outcome', is_leaf: true, order_no: 12 },
  { id: 'r.u1.k1.b', parent_id: 'r.u1.k1', name: 'Kuantum modeli', kind: 'sub_outcome', is_leaf: true, order_no: 13 },
  { id: 'r.u1.k2', parent_id: 'r.u1', name: 'Atomun yapısı', kind: 'outcome', is_leaf: true, order_no: 14 },
  { id: 'r.u2.k3', parent_id: 'r.u2', name: 'İyonik bağ', kind: 'outcome', is_leaf: true, order_no: 21 },
];

describe('ağaç mantığı (curriculum-tree)', () => {
  const tree = buildTree(ROWS);
  it('sıralı numaralandırma (kök numarasız)', () => {
    expect(tree.root?.name).toBe('Kimya');
    expect(tree.flat.map((t) => `${t.number} ${t.name}`)).toEqual([
      '1 Atom',
      '1.1 Atom modelleri',
      '1.1.1 Bohr modeli',
      '1.1.2 Kuantum modeli',
      '1.2 Atomun yapısı',
      '2 Bağlar',
      '2.1 İyonik bağ',
    ]);
    expect(subtreeSummary(tree.byId.get('r.u1')!)).toBe('2 kazanım · 2 alt kazanım');
  });
  it('taşıma hedefleri: kendi alt ağacı, şimdiki üstü ve 4 derinliği aşanlar hariç', () => {
    expect(moveTargets(tree, 'r.u1.k1').map((t) => t.id)).toEqual(['r', 'r.u2']);
    expect(moveTargets(tree, 'r.u2.k3').map((t) => t.id)).toEqual(['r', 'r.u1', 'r.u1.k1', 'r.u1.k2']);
    expect(moveTargets(tree, 'r.u1').map((t) => t.id)).toEqual([]);
  });
  it('birleştirme hedefleri: üst zinciri ve alt ağacı hariç', () => {
    expect(mergeTargets(tree, 'r.u1.k2').map((t) => t.id)).toEqual(['r.u1.k1', 'r.u1.k1.a', 'r.u1.k1.b', 'r.u2', 'r.u2.k3']);
    expect(mergeTargets(tree, 'r.u1.k1').map((t) => t.id)).not.toContain('r.u1.k1.a');
    expect(mergeTargets(tree, 'r.u1.k1').map((t) => t.id)).not.toContain('r.u1');
  });
  it('hata kodları Türkçe ileti, güven kelime bandı, öneri başlığı', () => {
    expect(curriculumErrorMessage('OGR-CURR-023 kanıt var')).toMatch(/yeni sürüm/i);
    expect(curriculumErrorMessage('OGR-AUTH-002 x')).toMatch(/yetkin yok/);
    expect(curriculumErrorMessage('OGR-CURR-026 daha yeni açık taslak var')).toMatch(/Açık taslağa geç/);
    expect(curriculumErrorMessage('OGR-CURR-031 yeni sürüm ister')).toMatch(/yeni taslak sürüm/);
    expect(curriculumErrorMessage(undefined)).toMatch(/yeniden dene/);
    expect(confidenceBand(0.93)).toBe('güven çok yüksek');
    expect(confidenceBand(0.6)).toBe('güven orta');
    expect(confidenceBand(null)).toBeNull();
    const names = new Map([['r.u1.k2', 'Atomun yapısı'], ['r.u1', 'Atom']]);
    expect(proposalHeadline('rename', { skill_id: 'r.u1.k2', name: 'Yapı' }, names)).toBe('"Atomun yapısı" → "Yapı"');
    expect(proposalHeadline('add_subskill', { parent_id: 'r.u1', name: 'İzotop' }, names)).toBe('İzotop (Atom altına)');
    expect(isUuid('00000000-0000-4000-8000-000000000001')).toBe(true);
    expect(isUuid('x')).toBe(false);
  });
});

function renderEditor(onEdit = vi.fn(async (_c: TreeChange) => ({ ok: true })), editable = true) {
  render(<TreeEditor skills={ROWS} editable={editable} readOnlyReason="Yayındaki sürüm düzenlenmez." onEdit={onEdit} />);
  return onEdit;
}

const row = (id: string) => screen.getByTestId(`node-${id}`);
const select = (name: string) => fireEvent.click(screen.getByRole('button', { name, pressed: false }));

describe('TreeEditor (ağaç editörü)', () => {
  it('katlanır: üniteler açık başlar, kazanımın alt düğümleri kapalı; Tümünü aç', () => {
    renderEditor();
    expect(screen.getByText('Atom modelleri')).toBeInTheDocument();
    expect(screen.queryByText('Bohr modeli')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atom modelleri alt düğümleri' }));
    expect(screen.getByText('Bohr modeli')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atom alt düğümleri' }));
    expect(screen.queryByText('Atom modelleri')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tümünü aç' }));
    expect(screen.getByText('Kuantum modeli')).toBeInTheDocument();
  });

  it('satır içi yeniden adlandırma: Enter kaydeder, Esc vazgeçer', async () => {
    const onEdit = renderEditor();
    select('Atomun yapısı');
    fireEvent.click(within(row('r.u1.k2')).getByRole('button', { name: 'Adı değiştir' }));
    const input = screen.getByRole('textbox', { name: 'Kazanım adı' });
    expect(screen.getByText(/Eski ad: "Atomun yapısı"/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Atom vazgeç' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Kazanım adı' })).not.toBeInTheDocument();
    expect(onEdit).not.toHaveBeenCalled();
    fireEvent.click(within(row('r.u1.k2')).getByRole('button', { name: 'Adı değiştir' }));
    const again = screen.getByRole('textbox', { name: 'Kazanım adı' });
    fireEvent.change(again, { target: { value: '  Atomun yapısı ve tanecikler ' } });
    fireEvent.keyDown(again, { key: 'Enter' });
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith({ op: 'rename', skill_id: 'r.u1.k2', name: 'Atomun yapısı ve tanecikler' }));
  });

  it('alt kazanım ekle (Enter), kısa ad reddedilir', async () => {
    const onEdit = renderEditor();
    select('Atomun yapısı');
    fireEvent.click(within(row('r.u1.k2')).getByRole('button', { name: 'Alt kazanım ekle' }));
    const input = screen.getByRole('textbox', { name: 'Atomun yapısı altına yeni kazanım adı' });
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('Ad en az 2 karakter olmalı.')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'Proton ve nötron' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith({ op: 'add', parent_id: 'r.u1.k2', name: 'Proton ve nötron' }));
  });

  it('yukarı/aşağı: ilk kardeşte Yukarı, son kardeşte Aşağı kapalı', async () => {
    const onEdit = renderEditor();
    select('Atom');
    const bar = within(row('r.u1')).getAllByRole('toolbar')[0]!;
    expect(within(bar).getByRole('button', { name: 'Yukarı' })).toBeDisabled();
    fireEvent.click(within(bar).getByRole('button', { name: 'Aşağı' }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith({ op: 'move', skill_id: 'r.u1', direction: 'down' }));
  });

  it('başka üst düğüme taşı: yalnız geçerli hedefler listelenir', async () => {
    const onEdit = renderEditor();
    select('İyonik bağ');
    fireEvent.click(within(row('r.u2.k3')).getByRole('button', { name: 'Taşı' }));
    const sel = screen.getByRole('combobox', { name: 'İyonik bağ için yeni üst düğüm' });
    const opts = within(sel).getAllByRole('option').map((o) => o.textContent);
    expect(opts).toEqual(['Seç', 'Kök: Kimya', '1 Atom', '1.1 Atom modelleri', '1.2 Atomun yapısı']);
    expect(screen.getByRole('button', { name: 'Buraya taşı' })).toBeDisabled();
    fireEvent.change(sel, { target: { value: 'r.u1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Buraya taşı' }));
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith({ op: 'move', skill_id: 'r.u2.k3', parent_id: 'r.u1' }));
  });

  it('birleştir: seçilen düğüm silinir (drop), hedef kalır (keep); sunucu hatası gösterilir', async () => {
    const onEdit = vi.fn(async (_c: TreeChange) => ({ ok: false, error: 'Bu kazanımın öğrenci kanıtı var; bu sürümde birleştirilemez.' }));
    renderEditor(onEdit);
    select('Atomun yapısı');
    fireEvent.click(within(row('r.u1.k2')).getByRole('button', { name: 'Birleştir' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Atomun yapısı hangi kazanımla birleşsin' }), { target: { value: 'r.u1.k1' } });
    fireEvent.click(within(row('r.u1.k2')).getAllByRole('button', { name: 'Birleştir' }).at(-1)!);
    await waitFor(() => expect(onEdit).toHaveBeenCalledWith({ op: 'merge', keep_id: 'r.u1.k1', drop_id: 'r.u1.k2' }));
    expect(await screen.findByText(/öğrenci kanıtı var/)).toBeInTheDocument();
  });

  it('arama eşleşen düğümü ve üst zincirini gösterir', () => {
    renderEditor();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Ağaçta ara' }), { target: { value: 'kuantum' } });
    expect(screen.getByText('Kuantum modeli')).toBeInTheDocument();
    expect(screen.getByText('Atom modelleri')).toBeInTheDocument();
    expect(screen.queryByText('İyonik bağ')).not.toBeInTheDocument();
  });

  it('salt okunur: araç çubuğu yok, neden yazılır', () => {
    renderEditor(vi.fn(), false);
    select('Atom');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.getByText('Yayındaki sürüm düzenlenmez.')).toBeInTheDocument();
  });
});

describe('ProposalsBox ve EditorActions', () => {
  it('öneri kartı: başlık, gerekçe, güven bandı; Kabul et karar çağırır', async () => {
    const onDecide = vi.fn(async () => ({ ok: true }));
    render(
      <ProposalsBox
        proposals={[{ id: 'p1', kind: 'add_subskill', payload: { parent_id: 'r.u1', name: 'İzotoplar', review: { action: 'accept', confidence: 0.86, rationale: 'Ağaçta karşılığı yok.' } }, evidenceCount: 5 }]}
        names={{ 'r.u1': 'Atom' }}
        canDecide
        onDecide={onDecide}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Öneriler (1)' })).toBeInTheDocument();
    expect(screen.getByText('İzotoplar (Atom altına)')).toBeInTheDocument();
    expect(screen.getByText('güven yüksek · 5 kanıt')).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Kabul et' }));
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith('p1', true));
  });

  it('taslakta tek birincil düğme Yayınla (onaylı, ekli sürüm adı yok); otopilot uygun değilse anahtar kapalı ve nedeni yazılı', async () => {
    const onPublish = vi.fn(async () => ({ ok: true }));
    render(
      <EditorActions
        curriculumId="c1"
        status="draft"
        version="3"
        canEdit
        canPublish
        hasTree
        autopilot={{ eligible: false, effective: false, reason: 'not_exam_track' }}
        draftChildId={null}
        onPublish={onPublish}
        onNewVersion={vi.fn()}
        onAutopilot={vi.fn()}
      />,
    );
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText(/yalnız TYT, AYT ve LGS/)).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Bu sürümü yayınla' }));
    fireEvent.click(screen.getByRole('button', { name: 'Evet, yayınla' }));
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(1));
  });

  it('otopilot uygun: anahtar eylemi çağırır', async () => {
    const onAutopilot = vi.fn(async () => ({ ok: true }));
    render(
      <EditorActions curriculumId="c1" status="active" version="2" canEdit canPublish hasTree autopilot={{ eligible: true, effective: false, reason: 'flag' }} draftChildId={null}
        onPublish={vi.fn()} onNewVersion={vi.fn()} onAutopilot={onAutopilot} />,
    );
    expect(screen.getByRole('button', { name: 'Yeni sürüm aç' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(onAutopilot).toHaveBeenCalledWith(true));
  });

  it('yayın yetkisi yoksa (paylaşılan müfredat): yayın düğmesi ve otopilot anahtarı yok, nedeni yazılı', () => {
    render(
      <EditorActions curriculumId="c1" status="draft" version="2" canEdit canPublish={false} hasTree autopilot={{ eligible: true, effective: true, reason: 'flag' }} draftChildId={null}
        onPublish={vi.fn()} onNewVersion={vi.fn()} onAutopilot={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Bu sürümü yayınla' })).not.toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeDisabled();
    expect(screen.getByText(/başka eğitmenlerin öğrencileri de kullanıyor/)).toBeInTheDocument();
  });

  it('taslaktan açılmış daha yeni taslak varsa: yayın yerine tek birincil düğme "Açık taslağa git"', () => {
    render(
      <EditorActions curriculumId="c1" status="draft" version="1" canEdit canPublish hasTree hasStudents autopilot={{ eligible: true, effective: true, reason: 'flag' }}
        draftChildId="c2" onPublish={vi.fn()} onNewVersion={vi.fn()} onAutopilot={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Bu sürümü yayınla' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yeni sürüm aç' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Açık taslağa git' }));
    expect(router.push).toHaveBeenCalledWith('/egitmen/mufredatlar/c2');
  });

  it('öğrencisi olan taslak: yayın birincil, ikincil "Yeni sürüm aç" (kanıtlı kazanım birleştirmesi için)', async () => {
    const onNewVersion = vi.fn(async () => ({ ok: true, id: 'c3' }));
    render(
      <EditorActions curriculumId="c1" status="draft" version="1" canEdit canPublish hasTree hasStudents autopilot={{ eligible: true, effective: true, reason: 'flag' }}
        draftChildId={null} onPublish={vi.fn()} onNewVersion={onNewVersion} onAutopilot={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Bu sürümü yayınla' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yeni sürüm aç' }));
    await waitFor(() => expect(onNewVersion).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/egitmen/mufredatlar/c3'));
  });

  it('yayındaki sürümde öneri kabulü açık taslağa yazılır: kutu bunu söyler', () => {
    render(
      <ProposalsBox
        proposals={[{ id: 'p1', kind: 'rename', payload: { skill_id: 'r.u1', name: 'Atom yapısı' }, evidenceCount: 0 }]}
        names={{ 'r.u1': 'Atom' }}
        canDecide
        acceptNote="Kabul ettiğin öneri açık taslak sürüme eklenir; yayındaki sürüm değişmez."
        onDecide={vi.fn(async () => ({ ok: true }))}
      />,
    );
    expect(screen.getByText(/açık taslak sürüme eklenir/)).toBeInTheDocument();
  });

  it('düşen taslak: tek birincil düğme "Taslağı yeniden kur" (yayın yok)', async () => {
    const onRetry = vi.fn(async () => ({ ok: true }));
    render(
      <EditorActions curriculumId="c1" status="draft" version="1" canEdit canPublish hasTree={false} canRetry autopilot={{ eligible: false, effective: false, reason: 'not_exam_track' }}
        draftChildId={null} onPublish={vi.fn()} onNewVersion={vi.fn()} onAutopilot={vi.fn()} onRetry={onRetry} />,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Taslağı yeniden kur' }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  });
});

describe('DraftProgress', () => {
  it('Realtime bağlıyken yalnız seyrek nabız; kopunca 2 sn → 3 sn yoklar; ilerleme sayı olarak yazılmaz', async () => {
    vi.useFakeTimers();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    try {
      router.refresh.mockClear();
      const view = render(<DraftProgress curriculumId="c1" status="drafting" progress={45} />);
      expect(screen.getByText('Ağaç kuruluyor')).toBeInTheDocument();
      expect(screen.queryByText(/45/)).not.toBeInTheDocument();
      realtime.state.cb!('SUBSCRIBED');
      await vi.advanceTimersByTimeAsync(LIVE_DEFAULTS.heartbeatMs - 1_000);
      expect(router.refresh).not.toHaveBeenCalled();
      realtime.state.cb!('CHANNEL_ERROR');
      await vi.advanceTimersByTimeAsync(2_000);
      expect(router.refresh).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(router.refresh).toHaveBeenCalledTimes(2);
      view.unmount();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(router.refresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllEnvs();
      vi.useRealTimers();
    }
  });
});

// curriculum-types.ts elle yazılır: Row alanları göçlerdeki sütunlar olmalı (create table + alter table add column)
describe('müfredat tipleri ↔ göçler', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const sql = fs
    .readdirSync(path.join(ROOT, 'supabase/migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => fs.readFileSync(path.join(ROOT, 'supabase/migrations', f), 'utf8'))
    .join('\n');
  const cols = (table: string) => {
    const set = new Set<string>();
    const m = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
    for (const line of (m?.[1] ?? '').split('\n')) {
      const c = /^\s{2}(\w+)\s+(?!\()[a-z]/.exec(line);
      if (c?.[1] && !['primary', 'unique', 'check', 'constraint', 'foreign'].includes(c[1])) set.add(c[1]);
    }
    for (const a of sql.matchAll(new RegExp(`alter table public\\.${table} add column (?:if not exists )?(\\w+)`, 'g'))) set.add(a[1] as string);
    return set;
  };
  const src = fs.readFileSync(path.resolve(__dirname, '../src/lib/supabase/curriculum-types.ts'), 'utf8');
  const fields = (name: string) => {
    const m = new RegExp(`export type ${name} = \\{([\\s\\S]*?)\\n\\};`).exec(src);
    return [...(m?.[1] ?? '').matchAll(/^\s{2}(\w+)\??:/gm)].map((f) => f[1] as string);
  };
  it.each([
    ['CurriculumRow', 'curricula'],
    ['SkillDbRow', 'skills'],
    ['CurriculumProposalRow', 'curriculum_proposals'],
  ])('%s → %s', (type, table) => {
    const have = cols(table);
    const f = fields(type);
    expect(f.length).toBeGreaterThan(5);
    expect(f.filter((x) => !have.has(x))).toEqual([]);
    expect([...have].filter((x) => !f.includes(x))).toEqual([]);
  });
});
