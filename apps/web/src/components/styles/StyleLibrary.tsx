'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown } from 'lucide-react';
import { Badge, Button, Notice, TextField } from '@/ds';
import { SelectField } from '@/components/SelectField';
import { cn } from '@/lib/cn';
import { useLive } from '@/lib/live';
import {
  arrangeStyles,
  bandWord,
  correctText,
  coverageText,
  DIFFICULTY_WORD,
  frequencyText,
  needsNaming,
  recencyText,
  scoreText,
  SORTS,
  type LibraryStyle,
  type StyleFilter,
  type StyleSort,
} from '@/server/styles/shared';

type Result = Promise<{ ok: boolean; message: string }>;

export interface StyleActions {
  save: (input: { courseId: string; code: string; name: string; description: string }) => Result;
  add: (input: { courseId: string; name: string; description: string }) => Result;
  merge: (keepId: string, mergeId: string) => Result;
  generate: (styleId: string, count?: number) => Result;
}

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-transparent focus-visible:shadow-focus-ring';
const SHOWN = 12;
const WATCH_MS = 15 * 60_000;

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'text-small box-border inline-flex min-h-11 items-center gap-2 rounded-md border px-3 font-medium',
        FOCUS,
        pressed ? 'border-primary bg-primary-soft text-primary' : 'border-line-strong bg-surface-raised text-ink hover:bg-surface-sunken',
      )}
    >
      {children}
    </button>
  );
}

/** Frekans çubuğu: yıl başına bir kutu (çıktı = dolu). Yüzde yok; metin "6/8 yıl". */
function YearBar({ style }: { style: LibraryStyle }) {
  const total = Math.min(style.years_total ?? 0, 16);
  const hit = style.years_hit.length;
  if (total === 0) return null;
  return (
    <span aria-hidden="true" className="flex gap-0.5">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={cn('h-2 w-3 rounded-[2px]', i < hit ? 'bg-primary' : 'bg-primary-soft')} />
      ))}
    </span>
  );
}

function StyleCard({ style, courseId, others, canManage, actions, onNote }: { style: LibraryStyle; courseId: string; others: LibraryStyle[]; canManage: boolean; actions: StyleActions; onNote: (n: { ok: boolean; text: string }) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<'view' | 'edit' | 'merge'>('view');
  const [name, setName] = useState(style.name);
  const [desc, setDesc] = useState(style.description ?? '');
  const [target, setTarget] = useState('');
  const naming = needsNaming(style);
  const done = (r: { ok: boolean; message: string }, close = true) => {
    onNote({ ok: r.ok, text: r.message });
    if (r.ok) {
      if (close) setMode('view');
      router.refresh();
    }
  };
  const cov = style.coverage;
  const unsolved = cov.unsolved;

  return (
    <li data-testid={`tarz-${style.code}`} className="flex min-w-0 flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4 shadow-sm">
      {mode === 'edit' ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => done(await actions.save({ courseId, code: style.code, name, description: desc })));
          }}
        >
          <TextField label="Tarz adı" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
          <div className="flex flex-col gap-1">
            <label htmlFor={`tanim-${style.id}`} className="text-label text-ink">
              Tanım
            </label>
            <textarea
              id={`tanim-${style.id}`}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              maxLength={500}
              rows={3}
              className={cn('text-body box-border min-h-24 rounded-sm border border-line-strong bg-surface-raised px-3 py-2 text-ink', FOCUS)}
            />
            <span className="text-caption text-ink-muted">Öğrenciye çıkmış sorunun metni değil, yalnız bu tanım gösterilir.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" disabled={pending}>
              Kaydet
            </Button>
            <Button type="button" variant="quiet" disabled={pending} onClick={() => setMode('view')}>
              Vazgeç
            </Button>
          </div>
        </form>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-title-3 m-0 min-w-0 text-ink">{style.name}</h3>
            <div className="flex flex-wrap items-center gap-2">
              {naming ? <Badge tone="ai">Adı onay bekliyor</Badge> : null}
              {style.status === 'draft' && !naming ? <Badge tone="warning">Taslak</Badge> : null}
              {style.format ? <Badge tone="primary">{style.format}</Badge> : null}
            </div>
          </div>
          {style.description ? <p className="text-small m-0 line-clamp-2 text-ink-muted">{style.description}</p> : <p className="text-small m-0 text-ink-muted">Tanım yok.</p>}
          <dl className="m-0 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
            <dt className="text-caption text-ink-muted">Sıklık</dt>
            <dd className="m-0 flex flex-wrap items-center gap-2">
              <YearBar style={style} />
              <span className="text-small text-ink tabular-nums">{frequencyText(style)}</span>
            </dd>
            <dt className="text-caption text-ink-muted">Güncellik</dt>
            <dd className="text-small m-0 text-ink">{recencyText(style)}</dd>
            <dt className="text-caption text-ink-muted">Kapsama</dt>
            <dd className="text-small m-0 text-ink">{coverageText(cov)}</dd>
          </dl>
          {style.skills.length > 0 ? (
            <ul aria-label="Kazanımlar" className="m-0 flex list-none flex-wrap gap-2 p-0">
              {style.skills.map((k) => (
                <li key={k.id} className="text-caption rounded-sm bg-surface-sunken px-2 py-1 text-ink">
                  {k.name ?? k.id}
                </li>
              ))}
            </ul>
          ) : null}

          <details className="group">
            <summary className="text-label flex min-h-11 cursor-pointer list-none items-center gap-1 text-primary [&::-webkit-details-marker]:hidden">
              Ayrıntı
              <ChevronDown aria-hidden="true" size={16} className="transition-transform group-open:rotate-180" />
            </summary>
            <div className="flex flex-col gap-3 pt-1">
              {style.trick ? (
                <p className="text-small m-0 text-ink">
                  <span className="text-ink-muted">Tuzak: </span>
                  {style.trick}
                </p>
              ) : null}
              <p className="text-small m-0 text-ink">
                <span className="text-ink-muted">Skor {scoreText(style.score)}: </span>
                sıklık {bandWord(style.frequency)}, güncellik {bandWord(style.recency)}, müfredat uyumu {bandWord(style.alignment)}
                {style.difficulty_band ? ` · zorluk ${DIFFICULTY_WORD[style.difficulty_band] ?? style.difficulty_band}` : ''}
              </p>
              {style.appearances.length > 0 ? (
                <p className="text-small m-0 text-ink">
                  <span className="text-ink-muted">Çıktığı sınavlar: </span>
                  {style.appearances.map((a) => `${a.year ?? '—'} · S${a.item_no}`).join('   ')}
                </p>
              ) : null}
              <p className="text-small m-0 text-ink">
                {correctText(cov) ? `Çözenlerde: ${correctText(cov)}.` : 'Henüz çözen yok.'}
                {unsolved.length > 0 && cov.students_total > 0 ? ` Hiç çözmeyen ${unsolved.length} öğrenci: ${unsolved.slice(0, 5).map((u) => u.display_name ?? 'Öğrenci').join(', ')}${unsolved.length > 5 ? '…' : ''}.` : ''}
              </p>
            </div>
          </details>

          {canManage ? (
            mode === 'merge' ? (
              <div className="flex flex-col gap-2">
                <SelectField
                  label="Bu tarzı şuna kat"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="Tarz seç"
                  options={others.filter((o) => o.id !== style.id).map((o) => ({ value: o.id, label: o.name }))}
                  hint="Bu tarzın soruları, teşhisleri ve üretilen soruları seçtiğin tarza taşınır; bu tarz silinir."
                />
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" disabled={pending || !target} onClick={() => start(async () => done(await actions.merge(target, style.id)))}>
                    Birleştir
                  </Button>
                  <Button variant="quiet" disabled={pending} onClick={() => setMode('view')}>
                    Vazgeç
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" disabled={pending || style.status === 'retired'} onClick={() => start(async () => done(await actions.generate(style.id, 5), false))}>
                  5 soru üret
                </Button>
                <Button variant="quiet" size="sm" disabled={pending} onClick={() => setMode('edit')}>
                  Düzenle
                </Button>
                <Button variant="quiet" size="sm" disabled={pending || others.length < 2} onClick={() => setMode('merge')}>
                  Birleştir
                </Button>
              </div>
            )
          ) : null}
        </>
      )}
    </li>
  );
}

function AddStyle({ courseId, add, onNote }: { courseId: string; add: StyleActions['add']; onNote: (n: { ok: boolean; text: string }) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [pending, start] = useTransition();
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Tarz ekle
      </Button>
    );
  }
  return (
    <form
      className="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4"
      aria-label="Tarz ekle"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await add({ courseId, name, description: desc });
          onNote({ ok: r.ok, text: r.message });
          if (r.ok) {
            setName('');
            setDesc('');
            setOpen(false);
            router.refresh();
          }
        });
      }}
    >
      <TextField label="Yeni tarzın adı" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      <TextField label="Tanım (isteğe bağlı)" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} />
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={pending || name.trim().length < 3}>
          Ekle
        </Button>
        <Button type="button" variant="quiet" disabled={pending} onClick={() => setOpen(false)}>
          Vazgeç
        </Button>
      </div>
    </form>
  );
}

/**
 * Tarz kütüphanesi (S13): sıralama + süzgeç, tarz kartları (ad, tanım, sıklık çubuğu, güncellik, kazanım çipleri,
 * kapsama), katlı ayrıntı; yeniden adlandır / birleştir / ekle / "5 soru üret" (yazım yetkisi olan eğitmen).
 * Tarzlara ayırma sürerken (pendingSources) sayfa kendiliğinden tazelenir.
 */
export function StyleLibrary({ courseId, styles, canManage, pendingSources, actions }: { courseId: string; styles: LibraryStyle[]; canManage: boolean; pendingSources: number; actions: StyleActions }) {
  const router = useRouter();
  const [sort, setSort] = useState<StyleSort>('priority');
  const [filter, setFilter] = useState<StyleFilter>('all');
  const [all, setAll] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const live = styles.filter((s) => s.status !== 'retired');
  const unnamed = live.filter(needsNaming).length;
  const list = arrangeStyles(styles, sort, filter);
  const shown = all ? list : list.slice(0, SHOWN);

  useLive({
    key: `tarz-${courseId}-${pendingSources}`,
    enabled: pendingSources > 0,
    timing: { maxElapsedMs: WATCH_MS, minMs: 4_000, maxMs: 8_000 },
    check: () => {
      router.refresh();
      return false;
    },
  });

  return (
    <section aria-labelledby="kutuphane-baslik" className="flex flex-col gap-4" data-testid="tarz-kutuphanesi">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="kutuphane-baslik" className="text-title-3 m-0 text-ink">
          Tarz kütüphanesi <span className="text-ink-muted tabular-nums">· {live.length} tarz</span>
        </h2>
        <SelectField label="Sırala" value={sort} onChange={(e) => setSort(e.target.value as StyleSort)} options={SORTS.map((s) => ({ value: s.value, label: s.label }))} className="w-56" />
      </div>
      {pendingSources > 0 ? (
        <Notice tone="info" live>
          {pendingSources} sınav tarzlara ayrılıyor; bitince burada görünür.
        </Notice>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Chip pressed={filter === 'all'} onClick={() => setFilter('all')}>
          Tümü <span className="text-caption tabular-nums">{live.length}</span>
        </Chip>
        {unnamed > 0 ? (
          <Chip pressed={filter === 'unnamed'} onClick={() => setFilter('unnamed')}>
            Adlandırma bekliyor <span className="text-caption tabular-nums">{unnamed}</span>
          </Chip>
        ) : null}
        {canManage ? <AddStyle courseId={courseId} add={actions.add} onNote={setNote} /> : null}
      </div>
      {note ? (
        <Notice tone={note.ok ? 'info' : 'warning'} live>
          {note.text}
        </Notice>
      ) : null}
      {shown.length === 0 ? (
        <p className="text-body m-0 text-ink-muted">{live.length === 0 ? 'Henüz tarz yok. Çıkmış sınavları yüklediğinde sorular tarzlara ayrılır.' : 'Bu süzgeçte tarz yok.'}</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2">
          {shown.map((s) => (
            <StyleCard key={s.id} style={s} courseId={courseId} others={live} canManage={canManage} actions={actions} onNote={setNote} />
          ))}
        </ul>
      )}
      {list.length > SHOWN ? (
        <Button variant="quiet" className="self-start" onClick={() => setAll((v) => !v)}>
          {all ? 'Daha az göster' : `${list.length - SHOWN} tarz daha göster`}
        </Button>
      ) : null}
      <p className="text-small m-0 text-ink-muted">Üretilen sorular doğrulamadan geçmeden öğrenciye gitmez. Öğrenciye çıkmış sorunun metni gösterilmez, yalnız tarz tanımı.</p>
    </section>
  );
}
