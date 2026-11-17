import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DraftProgress } from '@/components/curriculum/DraftProgress';
import { EditorActions } from '@/components/curriculum/EditorActions';
import { ProposalsBox, type ProposalItem } from '@/components/curriculum/ProposalsBox';
import { TreeEditor } from '@/components/curriculum/TreeEditor';
import { Badge, Notice } from '@/ds';
import { DRAFT_STATUS_LABELS, draftInProgress, isUuid, STATUS_LABELS, type DraftStatus, type ProposalKind } from '@/lib/curriculum-tree';
import { requireRole } from '@/server/auth';
import { getCurriculumEditor } from '@/server/curricula';
import { decideProposal, editTree, openNewVersion, publishCurriculum, retryDraft, setAutopilot } from './actions';

export const metadata: Metadata = { title: 'Müfredat editörü' };

const STATUS_TONE = { draft: 'warning', active: 'success', retired: 'neutral' } as const;
const dateFmt = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });

export default async function MufredatEditoru({ params }: { params: Promise<{ id: string }> }) {
  await requireRole('instructor', 'admin');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const data = await getCurriculumEditor(id);
  if (!data) notFound();
  const { curriculum: c, skills, proposals, courses, state } = data;
  const canEdit = state?.can_edit ?? false;
  // bu taslaktan daha yeni bir sürüm açıldıysa değişiklik orada yapılır (bu taslak yayınlanmaz: OGR-CURR-026)
  const editable = canEdit && c.status === 'draft' && !draftInProgress(c.draft_status) && !state?.draft_child_id;
  const title = courses[0] ?? c.label;
  const counts = state?.counts;
  const names = Object.fromEntries(skills.map((s) => [s.id, s.name]));
  const draft = state?.draft;
  const items: ProposalItem[] = proposals.map((p) => ({
    id: p.id,
    kind: p.kind as ProposalKind,
    payload: (p.payload ?? {}) as Record<string, unknown>,
    evidenceCount: p.evidence_ids?.length ?? 0,
  }));
  const facts = [
    state?.live_version && state.live_version.id !== c.id ? `Yayında: sürüm ${state.live_version.version}` : null,
    state ? `${state.enrollments} öğrenci kullanıyor` : null,
    counts ? `${counts.units} ünite · ${counts.outcomes} kazanım · ${counts.sub_outcomes} alt kazanım` : null,
    c.edited_at ? `Son kaydetme ${dateFmt.format(new Date(c.edited_at))}` : null,
  ].filter(Boolean);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <nav aria-label="Konum" className="text-small text-ink-muted">
        <Link href="/egitmen/mufredatlar" className="text-primary">
          Müfredatlar
        </Link>{' '}
        › {title}
      </nav>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title-1 m-0 text-ink">
            {title} · sürüm {c.version}
          </h1>
          <Badge tone={STATUS_TONE[c.status]}>{STATUS_LABELS[c.status]}</Badge>
        </div>
        <p className="text-small m-0 text-ink-muted">{facts.join(' · ')}</p>
      </header>

      {state ? (
        <EditorActions
          curriculumId={c.id}
          status={c.status}
          version={c.version}
          canEdit={canEdit}
          canPublish={state.can_publish}
          hasTree={(counts?.skills ?? 0) > 0 && !draftInProgress(c.draft_status)}
          canRetry={draft?.can_retry ?? false}
          autopilot={state.autopilot}
          draftChildId={state.draft_child_id}
          hasStudents={state.enrollments > 0}
          onPublish={publishCurriculum.bind(null, c.id)}
          onNewVersion={openNewVersion.bind(null, c.id)}
          onAutopilot={setAutopilot.bind(null, c.id)}
          onRetry={retryDraft.bind(null, c.id)}
        />
      ) : null}

      {draftInProgress(c.draft_status) ? <DraftProgress curriculumId={c.id} status={c.draft_status as DraftStatus} progress={c.draft_progress} /> : null}
      {c.draft_status === 'failed' ? (
        <Notice tone="warning" title={DRAFT_STATUS_LABELS.failed}>
          {draft?.can_retry ? 'Taslağı yeniden kurabilirsin; öğrenci ağaç hazır olunca başlar.' : 'Taslak işi tamamlanamadı.'}
          {draft?.error ? (
            <details className="mt-2">
              <summary className="cursor-pointer">Ayrıntı</summary>
              <span className="text-small">{draft.error}</span>
            </details>
          ) : null}
        </Notice>
      ) : null}
      {(state?.merge_errors?.length ?? 0) > 0 ? (
        <Notice tone="warning" title="Kabul ettiğin birleştirme uygulanamadı">
          Ağaçta elle birleştirebilir ya da öneriyi yeniden değerlendirebilirsin.
          <details className="mt-2">
            <summary className="cursor-pointer">Ayrıntı</summary>
            <span className="text-small">{state?.merge_errors?.map((e) => e.error).join(' · ')}</span>
          </details>
        </Notice>
      ) : null}
      {(draft?.notes_for_instructor || (draft?.tags_dropped.length ?? 0) > 0) && c.status === 'draft' ? (
        <details className="rounded-lg border border-line bg-surface-raised p-4">
          <summary className="text-label cursor-pointer text-ink">Taslak notu</summary>
          {draft?.notes_for_instructor ? <p className="text-body mt-2 mb-0 whitespace-pre-line text-ink-muted">{draft.notes_for_instructor}</p> : null}
          {draft && draft.tags_dropped.length > 0 ? (
            <p className="text-small mt-2 mb-0 text-ink-muted">Başka müfredatta aynı adla bulunduğu için eklenmeyen yanılgı etiketleri: {draft.tags_dropped.join(', ')}</p>
          ) : null}
        </details>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="rounded-lg border border-line bg-surface-raised p-4">
          <h2 className="text-title-3 mt-0 mb-3 text-ink">Kazanım ağacı</h2>
          <TreeEditor
            skills={skills}
            editable={editable}
            readOnlyReason={
              !canEdit
                ? 'Bu müfredatı düzenleme yetkin yok; yalnız görüntülüyorsun.'
                : c.status === 'active'
                  ? 'Yayındaki sürüm düzenlenmez. Değişiklik için yeni sürüm aç.'
                  : c.status === 'retired'
                    ? 'Emekli sürüm salt okunurdur.'
                    : state?.draft_child_id
                      ? 'Bu taslaktan yeni sürüm açıldı; değişiklikleri açık taslakta yap.'
                      : 'Taslak kurulurken ağaç düzenlenemez.'
            }
            onEdit={editTree.bind(null, c.id)}
          />
        </div>
        <ProposalsBox
          proposals={items}
          names={names}
          canDecide={canEdit && c.status !== 'retired'}
          acceptNote={
            c.status === 'active'
              ? 'Kabul ettiğin öneri açık taslak sürüme eklenir; yayındaki sürüm değişmez.'
              : state?.draft_child_id
                ? 'Kabul ettiğin öneri bu taslaktan açılan yeni sürüme eklenir.'
                : null
          }
          onDecide={decideProposal.bind(null, c.id)}
        />
      </div>
    </div>
  );
}
