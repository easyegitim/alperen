'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Search, Undo2 } from 'lucide-react';
import { Badge, Button, EvidenceQuote, MasteryMeter, Notice, cn } from '@/ds';
import {
  FOLLOWUP_EDIT,
  MASTERY_EDIT_BANDS,
  STATUS_WORDS,
  THRESHOLD,
  canEditClaim,
  claimLabel,
  claimText,
  confidenceWord,
  formatClock,
  formatHeld,
  type LessonClaim,
  type LessonStaffView,
  type Segment,
} from '@/server/lessons/shared';
import type { ClaimDecision, LessonActionResult } from '@/app/egitmen/dersler/actions';

export interface WorkspaceActions {
  review: (lessonId: string, claimId: string, decision: ClaimDecision, edit?: Record<string, unknown>) => Promise<LessonActionResult>;
  apply: (lessonId: string) => Promise<LessonActionResult>;
  options: (lessonId: string, o: { student_visible?: boolean; auto_apply_threshold?: number }) => Promise<LessonActionResult>;
}

const SPEAKER_CLASS: Record<string, string> = { 'EĞİTMEN': 'text-primary', 'ÖĞRENCİ': 'text-ink', 'DİĞER': 'text-ink-muted' };
const INLINE_ALL = 300;
const CONTEXT = 2;

function thresholdText(v: number): string {
  return v.toFixed(2).replace('.', ',');
}

/** İddianın alıntısının düştüğü transkript satırı (t_start_sec'i kapsayan ya da en yakın). */
function segmentFor(segs: Segment[], t: number | null): number {
  if (t == null || segs.length === 0) return -1;
  let best = -1;
  let dist = Infinity;
  for (const [i, s] of segs.entries()) {
    if (t >= s.t0 && t <= s.t1 + 0.5) return i;
    const d = Math.min(Math.abs(s.t0 - t), Math.abs(s.t1 - t));
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return dist <= 15 ? best : -1;
}

function Transcript({ segments, claims, active, labeled }: { segments: Segment[]; claims: LessonClaim[]; active: number; labeled: boolean }) {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(segments.length <= INLINE_ALL);
  const activeRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [active]);
  const claimIdx = useMemo(() => {
    const m = new Map<number, number[]>();
    claims.forEach((c, n) => {
      const i = segmentFor(segments, c.t_start_sec);
      if (i >= 0) m.set(i, [...(m.get(i) ?? []), n + 1]);
    });
    return m;
  }, [claims, segments]);
  const q = query.trim().toLocaleLowerCase('tr');
  const visible = useMemo(() => {
    if (q) return new Set(segments.flatMap((s, i) => (s.text.toLocaleLowerCase('tr').includes(q) ? [i] : [])));
    if (all) return null;
    const keep = new Set<number>();
    for (const i of claimIdx.keys()) for (let k = i - CONTEXT; k <= i + CONTEXT; k += 1) if (k >= 0 && k < segments.length) keep.add(k);
    if (active >= 0) keep.add(active);
    for (let k = 0; k < Math.min(3, segments.length); k += 1) keep.add(k);
    return keep;
  }, [q, all, claimIdx, segments, active]);
  const items: React.ReactNode[] = [];
  let hidden = 0;
  let hiddenSec = 0;
  const flush = (key: string) => {
    if (hidden > 0)
      items.push(
        <li key={`gap-${key}`} className="text-caption py-2 text-center text-ink-muted">
          <button type="button" className="min-h-9 underline" onClick={() => setAll(true)}>
            {Math.max(1, Math.round(hiddenSec / 60))} dk · {hidden} satır gizli
          </button>
        </li>,
      );
    hidden = 0;
    hiddenSec = 0;
  };
  segments.forEach((s, i) => {
    if (visible && !visible.has(i)) {
      hidden += 1;
      hiddenSec += Math.max(0, s.t1 - s.t0);
      return;
    }
    flush(String(i));
    const marks = claimIdx.get(i);
    const speaker = s.speaker ?? null;
    items.push(
      <li
        key={i}
        ref={i === active ? activeRef : undefined}
        data-testid="transkript-satiri"
        data-active={i === active || undefined}
        className={cn('flex gap-3 rounded-sm px-2 py-1.5 [content-visibility:auto]', i === active && 'bg-primary-soft')}
      >
        <span className="text-caption w-12 shrink-0 pt-0.5 text-ink-muted tabular-nums">{formatClock(s.t0)}</span>
        <div className="flex min-w-0 flex-col gap-0.5">
          {labeled && speaker ? <span className={cn('text-caption font-semibold tracking-wide', SPEAKER_CLASS[speaker] ?? 'text-ink-muted')}>{speaker}</span> : null}
          <span className="text-small text-ink">
            {s.text}
            {marks ? <span className="text-caption ml-2 font-medium text-primary">İddia {marks.join(', ')} kanıtı</span> : null}
          </span>
        </div>
      </li>,
    );
  });
  flush('end');
  return (
    <section aria-labelledby="transkript-baslik" className="flex min-h-0 flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="transkript-baslik" className="text-title-3 m-0 text-ink">
          Transkript <span className="text-small font-normal text-ink-muted">{segments.length} satır</span>
        </h2>
        <label className="text-small flex min-h-9 items-center gap-2 rounded-md border border-line-strong px-2 text-ink-muted">
          <Search aria-hidden="true" size={16} />
          <span className="sr-only">Transkriptte ara</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Transkriptte ara" className="w-40 bg-transparent text-ink outline-none" />
        </label>
      </div>
      {!labeled ? <p className="text-small m-0 text-ink-muted">Konuşmacılar henüz ayrılmadı.</p> : null}
      <ol aria-label="Transkript" className="m-0 max-h-[70vh] list-none overflow-y-auto p-0" tabIndex={0}>
        {items}
      </ol>
      {!all && !q ? (
        <Button variant="quiet" size="sm" onClick={() => setAll(true)}>
          Tüm transkripti göster
        </Button>
      ) : null}
    </section>
  );
}

function ClaimCard({
  n,
  claim,
  canManage,
  busy,
  active,
  onFocus,
  onDecide,
}: {
  n: number;
  claim: LessonClaim;
  canManage: boolean;
  busy: boolean;
  active: boolean;
  onFocus: () => void;
  onDecide: (d: ClaimDecision, edit?: Record<string, unknown>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const text = claimText(claim);
  const delta = claim.effect ? claim.effect.p_after - claim.effect.p_before : undefined;
  const statusWord = claim.applied ? 'Dossier’e uygulandı' : (STATUS_WORDS[claim.status] ?? claim.status);
  const tone = claim.status === 'rejected' ? 'neutral' : claim.applied ? 'success' : claim.status === 'pending' ? 'warning' : 'primary';
  const source = claim.t_start_sec != null ? formatClock(claim.t_start_sec) : 'Ders';
  return (
    <li
      data-testid="iddia"
      data-status={claim.status}
      data-applied={claim.applied || undefined}
      className={cn('flex flex-col gap-3 rounded-lg border bg-surface-raised p-4', active ? 'border-primary' : 'border-line')}
    >
      <button type="button" onClick={onFocus} className="flex flex-col gap-1 text-left" aria-label={`İddia ${n}: kanıtı transkriptte göster`}>
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-label text-ink">
            {n} · {claimLabel(claim.kind)}
          </span>
          <Badge tone={tone}>{statusWord}</Badge>
        </span>
        <span className="text-caption text-ink-muted">
          {confidenceWord(claim.confidence)}
          {claim.auto ? ' · otomatik uygulandı' : claim.status === 'pending' && claim.below_threshold ? ' · eşiğin altında' : ''}
        </span>
      </button>
      <p className="text-body m-0 text-ink">{text}</p>
      {claim.kind === 'skill_mastery' && claim.skill_name ? (
        <MasteryMeter skill={claim.skill_name} p={claim.mastery?.p} evidence={claim.mastery?.evidence_count} delta={delta} deltaLabel="bu ders" minEvidence={1} />
      ) : claim.skill_name ? (
        <p className="text-small m-0 text-ink-muted">{claim.skill_name}</p>
      ) : null}
      {claim.quote ? (
        <EvidenceQuote kind="lesson" source={source + (claim.speaker ? ` · ${claim.speaker}` : '')}>
          {`“${claim.quote}”`}
        </EvidenceQuote>
      ) : null}
      {canManage ? (
        editing ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Düzeltme">
            <span className="text-small text-ink-muted">{claim.kind === 'followup' ? 'Gerçekte' : 'Gerçekte ustalık'}:</span>
            {(claim.kind === 'followup' ? FOLLOWUP_EDIT.map((o) => ({ word: o.word, edit: { status: o.value } })) : MASTERY_EDIT_BANDS.map((o) => ({ word: o.word, edit: { mastery_estimate: o.value } }))).map((o) => (
              <Button
                key={o.word}
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  onDecide('edit', o.edit);
                }}
              >
                {o.word}
              </Button>
            ))}
            <Button variant="quiet" size="sm" onClick={() => setEditing(false)}>
              Vazgeç
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {claim.status !== 'approved' && claim.status !== 'edited' ? (
              <Button variant="secondary" size="sm" disabled={busy} icon={<Check size={16} />} onClick={() => onDecide('approve')}>
                Onayla
              </Button>
            ) : null}
            {canEditClaim(claim.kind) && claim.status !== 'rejected' ? (
              <Button variant="quiet" size="sm" disabled={busy} onClick={() => setEditing(true)}>
                Düzenle
              </Button>
            ) : null}
            {claim.status !== 'rejected' ? (
              <Button variant="quiet" size="sm" disabled={busy} icon={claim.applied ? <Undo2 size={16} /> : undefined} onClick={() => onDecide('reject')}>
                {claim.applied ? 'Geri al' : 'Reddet'}
              </Button>
            ) : null}
          </div>
        )
      ) : null}
    </li>
  );
}

type Filter = 'all' | 'pending' | 'applied';

/**
 * Ders iddia incelemesi (S14): üstte otomatik uygulama eşiği + "Dossier'e uygula" + "Öğrenciye görünür"; solda zaman
 * damgalı transkript, sağda iddialar (ustalık bandı, alıntı, güven kelimeyle, Onayla / Düzenle / Reddet). İddiaya
 * dokununca kanıtı transkriptte işaretlenir. Yazımlar sunucu eylemleriyle RPC'ye gider; sonra sayfa tazelenir.
 */
export function ReviewWorkspace({ view, actions }: { view: LessonStaffView; actions: WorkspaceActions }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const { lesson, claims, counts } = view;
  const segments = view.transcript?.segments ?? [];
  const [filter, setFilter] = useState<Filter>('all');
  const [activeClaim, setActiveClaim] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(lesson.auto_apply_threshold);
  const [visible, setVisible] = useState(lesson.student_visible);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const shown = claims.map((c, i) => ({ c, n: i + 1 })).filter(({ c }) => (filter === 'pending' ? c.status === 'pending' : filter === 'applied' ? c.applied : true));
  const active = segmentFor(segments, claims.find((c) => c.id === activeClaim)?.t_start_sec ?? null);

  function run(job: () => Promise<LessonActionResult>, after?: (r: LessonActionResult) => void) {
    start(async () => {
      const r = await job();
      setNote({ ok: r.ok, text: r.message });
      after?.(r);
      router.refresh();
    });
  }

  const lastApplied = claims.map((c) => c.applied_at).filter((x): x is string => Boolean(x)).sort().at(-1);
  const canManage = lesson.can_manage;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Uygulama" className="flex flex-col gap-4 rounded-lg border border-line bg-surface-raised p-4" data-testid="ders-secenekler">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex min-w-60 flex-1 flex-col gap-1">
            <label htmlFor="esik" className="text-label flex items-baseline justify-between text-ink">
              <span>Otomatik uygulama eşiği</span>
              <span className="tabular-nums" data-testid="esik-deger">
                {thresholdText(threshold)}
              </span>
            </label>
            <input
              id="esik"
              type="range"
              min={THRESHOLD.min}
              max={THRESHOLD.max}
              step={THRESHOLD.step}
              value={threshold}
              disabled={!canManage || pending}
              onChange={(e) => setThreshold(Number(e.target.value))}
              onPointerUp={() => run(() => actions.options(lesson.id, { auto_apply_threshold: threshold }))}
              onKeyUp={(e) => {
                if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') run(() => actions.options(lesson.id, { auto_apply_threshold: threshold }));
              }}
              className="w-full accent-[var(--color-primary)]"
            />
            <span className="text-caption flex justify-between text-ink-muted">
              <span>0,50</span>
              <span>0,75</span>
              <span>1,00</span>
            </span>
            <p className="text-small m-0 text-ink-muted">Güveni eşiğin üstündeki iddialar dossier’e kendiliğinden işlenir; altı senin onayını bekler.</p>
          </div>
          {canManage ? (
            <div className="flex flex-col items-start gap-1">
              <Button variant="primary" disabled={pending} onClick={() => run(() => actions.apply(lesson.id))} data-testid="dossiere-uygula">
                Dossier’e uygula
              </Button>
              <span className="text-caption text-ink-muted">{lastApplied ? `Son uygulama ${formatHeld(lastApplied)} · geri alınabilir` : 'Henüz uygulanmadı'}</span>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-small m-0 text-ink" data-testid="uygulama-durumu">
            <span className="font-medium">Dossier’e uygulandı</span> {counts.applied}/{counts.total} · {counts.pending} onay bekliyor · {counts.rejected} reddedildi
          </p>
          <button
            type="button"
            role="switch"
            aria-checked={visible}
            aria-label="Öğrenciye görünür"
            disabled={!canManage || pending}
            data-testid="ogrenciye-gorunur"
            onClick={() => {
              const next = !visible;
              setVisible(next);
              run(() => actions.options(lesson.id, { student_visible: next }), (r) => !r.ok && setVisible(!next));
            }}
            className="text-label flex min-h-11 items-center gap-3 text-ink disabled:opacity-60"
          >
            <span className={cn('relative inline-block h-6 w-11 rounded-full transition-colors', visible ? 'bg-primary' : 'bg-line-strong')}>
              <span className={cn('absolute top-0.5 size-5 rounded-full bg-white transition-all', visible ? 'left-5.5' : 'left-0.5')} />
            </span>
            Öğrenciye görünür
          </button>
        </div>
        {visible ? <p className="text-small m-0 text-ink-muted">Öğrenci yalnız onaylanan konuları, ödevi ve sonraki adımı görür; transkript ve alıntılar gizli kalır.</p> : null}
        {note ? (
          <Notice tone={note.ok ? 'info' : 'warning'} live>
            {note.text}
          </Notice>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {view.transcript ? (
          <Transcript segments={segments} claims={claims} active={active} labeled={view.transcript.labeled} />
        ) : (
          <section aria-label="Transkript" className="rounded-lg border border-line bg-surface-raised p-4">
            <p className="text-small m-0 text-ink-muted">Transkript henüz hazır değil.</p>
          </section>
        )}
        <section aria-labelledby="iddialar-baslik" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="iddialar-baslik" className="text-title-3 m-0 text-ink">
              İddialar <span className="text-small font-normal text-ink-muted">{claims.length}</span>
            </h2>
            <div role="tablist" aria-label="İddia süzgeci" className="flex gap-1">
              {(
                [
                  ['all', 'Tümü'],
                  ['pending', `Onay bekliyor ${counts.pending}`],
                  ['applied', `Uygulandı ${counts.applied}`],
                ] as [Filter, string][]
              ).map(([k, label]) => (
                <button
                  key={k}
                  role="tab"
                  type="button"
                  aria-selected={filter === k}
                  onClick={() => setFilter(k)}
                  className={cn('text-small min-h-9 rounded-full px-3', filter === k ? 'bg-primary-soft font-medium text-primary' : 'text-ink-muted hover:text-ink')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {claims.length === 0 ? (
            <p className="text-small m-0 rounded-lg border border-line bg-surface-raised p-4 text-ink-muted">Bu dersten henüz iddia çıkarılmadı.</p>
          ) : shown.length === 0 ? (
            <p className="text-small m-0 rounded-lg border border-line bg-surface-raised p-4 text-ink-muted">Bu süzgeçte iddia yok.</p>
          ) : (
            <ul aria-label="İddialar" className="m-0 flex list-none flex-col gap-3 p-0">
              {shown.map(({ c, n }) => (
                <ClaimCard
                  key={c.id}
                  n={n}
                  claim={c}
                  canManage={canManage}
                  busy={pending}
                  active={activeClaim === c.id}
                  onFocus={() => setActiveClaim(c.id)}
                  onDecide={(d, edit) => run(() => actions.review(lesson.id, c.id, d, edit))}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
