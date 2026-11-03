'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Notice } from '@/ds';

export interface EditorActionsProps {
  curriculumId: string;
  status: 'draft' | 'active' | 'retired';
  version: string;
  canEdit: boolean;
  /** Yayın / yeni sürüm / otopilot yetkisi (app.can_publish_curriculum: müfredatın sahibi ya da bütün öğrenciler senin). */
  canPublish: boolean;
  /** Taslakta yayınlanacak ağaç var mı (kurulurken ya da düşmüşken yok). */
  hasTree: boolean;
  /** Taslak işi düştü ve yeniden kurulabilir (curriculum_editor_state.draft.can_retry). */
  canRetry?: boolean;
  /** Otopilot: uygun mu (ai_draft + TYT/AYT/LGS), etkin mi, neden kapalı. */
  autopilot: { eligible: boolean; effective: boolean; reason: string };
  /** Bu sürümden (yayındaki ya da taslak) açılmış açık taslak varsa kimliği. */
  draftChildId: string | null;
  /** Taslağı kullanan öğrenci var mı (otopilotta kanıtlı taslak: birleştirme için yeni sürüm gerekir). */
  hasStudents?: boolean;
  onPublish: () => Promise<{ ok: boolean; error?: string }>;
  onNewVersion: () => Promise<{ ok: boolean; error?: string; id?: string }>;
  onAutopilot: (on: boolean) => Promise<{ ok: boolean; error?: string }>;
  onRetry?: () => Promise<{ ok: boolean; error?: string }>;
}

const AUTOPILOT_OFF_REASON: Record<string, string> = {
  origin: 'Otopilot yalnız yapay zekânın kurduğu müfredatlarda çalışır.',
  not_exam_track: 'Otopilot yalnız TYT, AYT ve LGS parkurlarında açılır; üniversite ve okul derslerinde karar senindir.',
};

/**
 * Editör başlığının eylemleri: otopilot anahtarı ve TEK birincil düğme — taslak düştüyse "Taslağı yeniden kur",
 * bu sürümden açılmış daha yeni taslak varsa "Açık taslağa git" (eski taslak yayınlanmaz: OGR-CURR-026), taslakta
 * "Bu sürümü yayınla", yayındaki sürümde "Yeni sürüm aç". Öğrencisi olan taslakta kanıtlı kazanım birleştirilemez
 * (OGR-CURR-023): orada ikincil "Yeni sürüm aç" da görünür. Yayın, yeni sürüm ve otopilot yalnız yayın yetkisiyle
 * (paylaşılan müfredatta başka eğitmenin öğrencileri de taşınır).
 */
export function EditorActions(props: EditorActionsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { status, canEdit, canPublish, autopilot } = props;
  const retry = status === 'draft' && props.canRetry === true && props.onRetry;
  const switchable = autopilot.eligible && canPublish;
  const child = status !== 'retired' && canEdit ? props.draftChildId : null;
  const openNew = () => go(props.onNewVersion, (id) => id && router.push(`/egitmen/mufredatlar/${id}`));

  const go = (fn: () => Promise<{ ok: boolean; error?: string; id?: string }>, after?: (id?: string) => void) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) setError(res.error ?? 'İşlem tamamlanamadı.');
      else after?.(res.id);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className={`text-label flex items-center gap-2 text-ink ${switchable ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}>
          <input
            type="checkbox"
            role="switch"
            aria-checked={autopilot.effective}
            checked={autopilot.effective}
            disabled={!switchable || pending}
            onChange={(e) => go(() => props.onAutopilot(e.target.checked))}
            className="size-5 accent-[var(--og-color-primary,currentColor)]"
          />
          Otopilot {autopilot.effective ? 'açık' : 'kapalı'}
        </label>
        {retry ? (
          <Button variant="primary" disabled={pending} onClick={() => go(retry)}>
            Taslağı yeniden kur
          </Button>
        ) : null}
        {child ? (
          <Button variant="primary" onClick={() => router.push(`/egitmen/mufredatlar/${child}`)}>
            Açık taslağa git
          </Button>
        ) : null}
        {status === 'draft' && canPublish && props.hasTree && !retry && !child ? (
          confirming ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-small text-ink">Yayınlayınca öğrencilerin konu haritası bu sürüme geçer.</span>
              <Button variant="primary" disabled={pending} onClick={() => go(props.onPublish, () => setConfirming(false))}>
                Evet, yayınla
              </Button>
              <Button variant="quiet" disabled={pending} onClick={() => setConfirming(false)}>
                Vazgeç
              </Button>
            </span>
          ) : (
            <Button variant="primary" disabled={pending} onClick={() => setConfirming(true)}>
              Bu sürümü yayınla
            </Button>
          )
        ) : null}
        {status === 'draft' && canPublish && props.hasTree && !retry && !child && props.hasStudents && !confirming ? (
          <Button variant="quiet" disabled={pending} onClick={openNew}>
            Yeni sürüm aç
          </Button>
        ) : null}
        {status === 'active' && canEdit && !child && canPublish ? (
          <Button variant="primary" disabled={pending} onClick={openNew}>
            Yeni sürüm aç
          </Button>
        ) : null}
      </div>
      {child && status === 'draft' ? (
        <p className="text-small m-0 text-ink-muted">Bu taslaktan yeni bir sürüm açılmış; yayın ve yeni değişiklikler orada.</p>
      ) : null}
      {canEdit && !canPublish && status !== 'retired' ? (
        <p className="text-small m-0 text-ink-muted">
          Bu müfredatı başka eğitmenlerin öğrencileri de kullanıyor; düzenleyebilir ve önerilere karar verebilirsin, yayını müfredatın sahibi ya da yönetici yapar.
        </p>
      ) : null}
      <p className="text-small m-0 text-ink-muted">
        {autopilot.eligible
          ? 'Otopilot, gece incelemesinde güveni çok yüksek önerileri taslağa kendisi ekler. Yayınlamak her zaman senin onayınla olur.'
          : (AUTOPILOT_OFF_REASON[autopilot.reason] ?? 'Otopilot bu müfredatta kapalı.')}
      </p>
      {error ? (
        <Notice tone="warning" live>
          {error}
        </Notice>
      ) : null}
    </div>
  );
}
