'use client';

import { useMemo, useState, useTransition, type KeyboardEvent } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GitMerge, MoveRight, Pencil, Plus } from 'lucide-react';
import { Badge, Button, Notice } from '@/ds';
import {
  buildTree,
  canAddChild,
  KIND_LABELS,
  mergeTargets,
  moveTargets,
  subtreeSummary,
  type SkillRow,
  type TreeItem,
} from '@/lib/curriculum-tree';

/** Sunucu eylemiyle aynı biçim (app/egitmen/mufredatlar/[id]/actions.ts). */
export type TreeChange =
  | { op: 'rename'; skill_id: string; name: string }
  | { op: 'add'; parent_id: string; name: string }
  | { op: 'move'; skill_id: string; direction: 'up' | 'down' }
  | { op: 'move'; skill_id: string; parent_id: string }
  | { op: 'merge'; keep_id: string; drop_id: string };

export interface TreeEditorProps {
  skills: SkillRow[];
  /** Taslak ve yetki varsa true; değilse ağaç salt okunur. */
  editable: boolean;
  /** Salt okunurken gösterilen kısa neden. */
  readOnlyReason?: string;
  onEdit: (change: TreeChange) => Promise<{ ok: boolean; error?: string }>;
}

type Mode = { kind: 'rename' | 'add' | 'move' | 'merge'; id: string } | null;

const ICON = 16;

/**
 * Eğitmen kazanım ağacı editörü (mockup S12): katlanır ağaç, satır içi yeniden adlandırma (Enter kaydet · Esc vazgeç),
 * alt kazanım ekleme, yukarı/aşağı sıralama, başka üst düğüme taşıma, birleştirme. Satıra tıklayınca araç çubuğu açılır.
 * Her değişiklik tek RPC'dir (curriculum_edit); sunucu yanıtı gelene dek düğmeler kilitlenir.
 */
export function TreeEditor({ skills, editable, readOnlyReason, onEdit }: TreeEditorProps) {
  const tree = useMemo(() => buildTree(skills), [skills]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(tree.root ? [tree.root.id, ...tree.root.children.map((c) => c.id)] : []));
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [draft, setDraft] = useState('');
  const [target, setTarget] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const q = query.trim().toLocaleLowerCase('tr');
  const visible = useMemo(() => {
    if (!q) return null;
    const keep = new Set<string>();
    for (const item of tree.flat) {
      if (item.name.toLocaleLowerCase('tr').includes(q) || item.number.startsWith(q)) {
        let cur: TreeItem | undefined = item;
        while (cur) {
          keep.add(cur.id);
          cur = cur.parentId ? tree.byId.get(cur.parentId) : undefined;
        }
      }
    }
    return keep;
  }, [q, tree]);

  if (!tree.root) {
    return <p className="text-body m-0 text-ink-muted">Bu sürümde henüz kazanım yok.</p>;
  }

  const run = (change: TreeChange) => {
    setError(null);
    start(async () => {
      const res = await onEdit(change);
      if (!res.ok) {
        setError(res.error ?? 'İşlem tamamlanamadı.');
        return;
      }
      if (change.op === 'add') setOpen((s) => new Set(s).add(change.parent_id));
      setMode(null);
      setDraft('');
      setTarget('');
    });
  };

  const begin = (kind: NonNullable<Mode>['kind'], item: TreeItem) => {
    setError(null);
    setSelected(item.id);
    setMode({ kind, id: item.id });
    setDraft(kind === 'rename' ? item.name : '');
    setTarget('');
  };

  const onTextKey = (e: KeyboardEvent<HTMLInputElement>, item: TreeItem) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setMode(null);
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const name = draft.trim();
    if (name.length < 2) {
      setError('Ad en az 2 karakter olmalı.');
      return;
    }
    if (mode?.kind === 'rename') {
      if (name !== item.name) run({ op: 'rename', skill_id: item.id, name });
      else setMode(null);
    } else if (mode?.kind === 'add') run({ op: 'add', parent_id: item.id, name });
  };

  const allOpen = tree.flat.every((t) => t.children.length === 0 || open.has(t.id));
  const toggleAll = () => setOpen(allOpen ? new Set([tree.root!.id]) : new Set([tree.root!.id, ...tree.flat.filter((t) => t.children.length > 0).map((t) => t.id)]));

  const renderItem = (item: TreeItem, siblings: TreeItem[], index: number) => {
    if (visible && !visible.has(item.id)) return null;
    const isOpen = visible ? true : open.has(item.id);
    const isSel = selected === item.id;
    const hasKids = item.children.length > 0;
    const editingName = mode?.id === item.id && mode.kind === 'rename';
    const indent = { paddingLeft: `${(item.depth - 2) * 20}px` };
    return (
      <li key={item.id} className="list-none" data-testid={`node-${item.id}`}>
        <div style={indent}>
          <div className={`flex min-h-11 items-center gap-2 rounded-md border px-1 ${isSel ? 'border-primary bg-primary-soft' : 'border-transparent hover:bg-surface-sunken'}`}>
            {hasKids ? (
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`${item.name} alt düğümleri`}
                onClick={() => setOpen((s) => {
                  const n = new Set(s);
                  if (n.has(item.id)) n.delete(item.id);
                  else n.add(item.id);
                  return n;
                })}
                className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-sm bg-transparent text-ink-muted"
              >
                {isOpen ? <ChevronDown aria-hidden="true" size={ICON} /> : <ChevronRight aria-hidden="true" size={ICON} />}
              </button>
            ) : (
              <span aria-hidden="true" className="size-9 shrink-0" />
            )}
            <span className="text-caption w-14 shrink-0 font-mono text-ink-muted">{item.number}</span>
            {editingName ? (
              <input
                autoFocus
                aria-label="Kazanım adı"
                value={draft}
                disabled={pending}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => onTextKey(e, item)}
                className="text-body box-border h-9 min-w-0 flex-1 rounded-sm border border-line-strong bg-surface-raised px-2 text-ink"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setSelected(isSel ? null : item.id);
                  if (!isSel) setMode(null);
                }}
                aria-pressed={isSel}
                className={`min-w-0 flex-1 cursor-pointer bg-transparent text-left text-ink ${item.depth === 2 ? 'text-label' : 'text-body'}`}
              >
                {item.name}
              </button>
            )}
            {item.kind ? <Badge tone="neutral">{KIND_LABELS[item.kind]}</Badge> : null}
            {hasKids ? <span className="text-caption hidden whitespace-nowrap text-ink-muted md:inline">{subtreeSummary(item)}</span> : null}
          </div>
          {editingName ? (
            <p className="text-caption m-0 mt-1 pl-24 text-ink-muted">Enter ile kaydet · Esc ile vazgeç · Eski ad: &quot;{item.name}&quot; · Kod ve ustalık kayıtları korunur</p>
          ) : null}
          {isSel && editable && !editingName ? (
            <div role="toolbar" aria-label={`${item.name} düzenleme`} className="mt-1 mb-2 flex flex-wrap items-center gap-1 pl-24">
              <Button size="sm" variant="quiet" icon={<ArrowUp size={ICON} />} disabled={pending || index === 0} onClick={() => run({ op: 'move', skill_id: item.id, direction: 'up' })}>
                Yukarı
              </Button>
              <Button size="sm" variant="quiet" icon={<ArrowDown size={ICON} />} disabled={pending || index === siblings.length - 1} onClick={() => run({ op: 'move', skill_id: item.id, direction: 'down' })}>
                Aşağı
              </Button>
              <Button size="sm" variant="quiet" icon={<Pencil size={ICON} />} disabled={pending} onClick={() => begin('rename', item)}>
                Adı değiştir
              </Button>
              {canAddChild(item) ? (
                <Button size="sm" variant="quiet" icon={<Plus size={ICON} />} disabled={pending} onClick={() => begin('add', item)}>
                  Alt kazanım ekle
                </Button>
              ) : null}
              <Button size="sm" variant="quiet" icon={<MoveRight size={ICON} />} disabled={pending} onClick={() => begin('move', item)}>
                Taşı
              </Button>
              <Button size="sm" variant="quiet" icon={<GitMerge size={ICON} />} disabled={pending} onClick={() => begin('merge', item)}>
                Birleştir
              </Button>
            </div>
          ) : null}
          {mode?.id === item.id && mode.kind === 'add' ? (
            <div className="mt-1 mb-2 flex flex-col gap-1 pl-24">
              <input
                autoFocus
                aria-label={`${item.name} altına yeni kazanım adı`}
                placeholder="Yeni alt kazanımın adı"
                value={draft}
                disabled={pending}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => onTextKey(e, item)}
                className="text-body box-border h-9 max-w-md rounded-sm border border-line-strong bg-surface-raised px-2 text-ink"
              />
              <span className="text-caption text-ink-muted">Enter ile ekle · Esc ile vazgeç · {item.number} {item.name} altına</span>
            </div>
          ) : null}
          {mode?.id === item.id && (mode.kind === 'move' || mode.kind === 'merge') ? (
            <TargetPicker
              kind={mode.kind}
              item={item}
              options={mode.kind === 'move' ? moveTargets(tree, item.id) : mergeTargets(tree, item.id)}
              rootId={tree.root!.id}
              value={target}
              pending={pending}
              onChange={setTarget}
              onCancel={() => setMode(null)}
              onConfirm={() => {
                if (!target) return;
                if (mode.kind === 'move') run({ op: 'move', skill_id: item.id, parent_id: target });
                else run({ op: 'merge', keep_id: target, drop_id: item.id });
              }}
            />
          ) : null}
        </div>
        {hasKids && isOpen ? (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">{item.children.map((c, i) => renderItem(c, item.children, i))}</ul>
        ) : null}
      </li>
    );
  };

  return (
    <section aria-label="Kazanım ağacı" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          aria-label="Ağaçta ara"
          placeholder="Ağaçta ara"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="text-body box-border h-9 min-w-48 flex-1 rounded-sm border border-line-strong bg-surface-raised px-2 text-ink"
        />
        <Button size="sm" variant="secondary" onClick={toggleAll}>
          {allOpen ? 'Tümünü kapat' : 'Tümünü aç'}
        </Button>
      </div>
      {!editable && readOnlyReason ? <p className="text-small m-0 text-ink-muted">{readOnlyReason}</p> : null}
      {error ? (
        <Notice tone="warning" live>
          {error}
        </Notice>
      ) : null}
      <p className="text-label m-0 text-ink">{tree.root.name}</p>
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0" aria-busy={pending}>
        {tree.root.children.map((c, i) => renderItem(c, tree.root!.children, i))}
      </ul>
    </section>
  );
}

function TargetPicker(props: {
  kind: 'move' | 'merge';
  item: TreeItem;
  options: TreeItem[];
  rootId: string;
  value: string;
  pending: boolean;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { kind, item, options, rootId, value, pending } = props;
  const label = kind === 'move' ? `${item.name} için yeni üst düğüm` : `${item.name} hangi kazanımla birleşsin`;
  return (
    <div className="mt-1 mb-2 flex flex-col gap-2 pl-24">
      <label className="text-small flex flex-col gap-1 text-ink">
        {label}
        <select
          aria-label={label}
          value={value}
          disabled={pending}
          onChange={(e) => props.onChange(e.target.value)}
          className="text-body box-border h-9 max-w-md rounded-sm border border-line-strong bg-surface-raised px-2 text-ink"
        >
          <option value="">Seç</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.id === rootId ? `Kök: ${o.name}` : `${o.number} ${o.name}`}
            </option>
          ))}
        </select>
      </label>
      {kind === 'merge' ? (
        <span className="text-caption text-ink-muted">
          &quot;{item.name}&quot; silinir; alt düğümleri, ön koşulları ve yanılgı etiketleri seçtiğin kazanıma geçer. Yayında ustalık kayıtları da ona taşınır.
        </span>
      ) : (
        <span className="text-caption text-ink-muted">Kod değişmez; öğrencilerin ustalık kayıtları korunur.</span>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={pending || !value} onClick={props.onConfirm}>
          {kind === 'move' ? 'Buraya taşı' : 'Birleştir'}
        </Button>
        <Button size="sm" variant="quiet" disabled={pending} onClick={props.onCancel}>
          Vazgeç
        </Button>
      </div>
    </div>
  );
}
