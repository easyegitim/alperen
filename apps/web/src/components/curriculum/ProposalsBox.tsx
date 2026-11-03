'use client';

import { useState, useTransition } from 'react';
import { Badge, Button, Notice } from '@/ds';
import { confidenceBand, PROPOSAL_KIND_LABELS, proposalHeadline, type ProposalKind } from '@/lib/curriculum-tree';

export interface ProposalItem {
  id: string;
  kind: ProposalKind;
  payload: Record<string, unknown>;
  evidenceCount: number;
}

export interface ProposalsBoxProps {
  proposals: ProposalItem[];
  /** Kazanım kodu → ad (başlıklar için). */
  names: Record<string, string>;
  canDecide: boolean;
  /** Kabulün nereye yazıldığı (yayındaki sürümde: açık taslak sürüme). */
  acceptNote?: string | null;
  onDecide: (proposalId: string, accept: boolean) => Promise<{ ok: boolean; error?: string }>;
}

/** Öneriler kutusu: tür, tek satır başlık, gece incelemesinin gerekçesi ve güven bandı; Kabul et / Reddet. */
export function ProposalsBox({ proposals, names, canDecide, acceptNote, onDecide }: ProposalsBoxProps) {
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nameMap = new Map(Object.entries(names));

  const decide = (id: string, accept: boolean) => {
    setError(null);
    setBusy(id);
    start(async () => {
      const res = await onDecide(id, accept);
      if (!res.ok) setError(res.error ?? 'Karar kaydedilemedi.');
      setBusy(null);
    });
  };

  return (
    <section aria-labelledby="oneriler-baslik" className="flex flex-col gap-3 rounded-lg border border-line bg-surface-raised p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="oneriler-baslik" className="text-title-3 m-0 text-ink">
          Öneriler ({proposals.length})
        </h2>
        <Badge tone="ai">Öğrenmen önerdi</Badge>
      </div>
      <p className="text-small m-0 text-ink-muted">Öğrenci teşhislerinden, ders kayıtlarından ve eğitmenlerden gelir. Kabul edilen yapısal değişiklik (birleştirme) yeni sürüm açar.</p>
      {canDecide && acceptNote && proposals.length > 0 ? <p className="text-small m-0 text-ink-muted">{acceptNote}</p> : null}
      {error ? (
        <Notice tone="warning" live>
          {error}
        </Notice>
      ) : null}
      {proposals.length === 0 ? <p className="text-body m-0 text-ink-muted">Açık öneri yok.</p> : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {proposals.map((p) => {
          const review = (p.payload.review ?? null) as { action?: string; confidence?: number; rationale?: string } | null;
          const band = confidenceBand(review?.confidence);
          return (
            <li key={p.id} data-testid={`proposal-${p.id}`} className="flex flex-col gap-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-small text-ink-muted">{PROPOSAL_KIND_LABELS[p.kind] ?? p.kind}</span>
                <span className="text-caption text-ink-muted">
                  {[band, p.evidenceCount > 0 ? `${p.evidenceCount} kanıt` : null].filter(Boolean).join(' · ')}
                </span>
              </div>
              <p className="text-label m-0 text-ink">{proposalHeadline(p.kind, p.payload, nameMap)}</p>
              {review?.rationale ? <p className="text-small m-0 text-ink-muted">{review.rationale}</p> : null}
              {review?.action === 'needs_instructor' ? <span className="text-caption text-ink-muted">Otopilot uygulamaz: karar senin.</span> : null}
              {canDecide ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => decide(p.id, true)} aria-busy={busy === p.id}>
                    Kabul et
                  </Button>
                  <Button size="sm" variant="quiet" disabled={pending} onClick={() => decide(p.id, false)}>
                    Reddet
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
