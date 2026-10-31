'use client';
// Tek bot cevabının denetim kartı: TutorMessage review satırı (model · maliyet · hafıza olgusu sayısı · İşaretle).
import * as React from 'react';
import { Badge, Button, Notice, TextField, TutorMessage } from '../lib/ds';
import { dateTime, usd } from '../lib/format';
import { useAction } from '../lib/hooks';
import { ActionResult, type StaffContext } from '../lib/shell';
import type { BotResponseRow } from '../lib/data';

function FlagForm({ row, onDone, onCancel, ds }: { row: BotResponseRow; onDone: () => void; onCancel: () => void } & Pick<StaffContext, 'ds'>) {
  const [reason, setReason] = React.useState('');
  const action = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await action.run(() => ds.flag(row.id, reason));
    if (r.ok) onDone();
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      <TextField label="İşaretleme nedeni" hint="Haftalık inceleme listesine düşer." value={reason} onChange={(e) => setReason(e.target.value)} required />
      <div className="row">
        <Button variant="secondary" size="sm" type="submit" disabled={action.busy || !reason.trim()}>
          İşaretle
        </Button>
        <Button variant="quiet" size="sm" type="button" onClick={onCancel}>
          Vazgeç
        </Button>
      </div>
      <ActionResult error={action.error} message={null} />
    </form>
  );
}

export function ResponseReview({ row, ctx, onChanged }: { row: BotResponseRow; ctx: StaffContext; onChanged: () => void }) {
  const [flagging, setFlagging] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);
  const onFlag = () => {
    if (!ctx.canEdit) {
      setNote('Gözlemci rolü cevap işaretleyemez.');
      return;
    }
    setFlagging(true);
  };
  return (
    <article className="card" aria-label={`Cevap ${row.id}`}>
      <div className="card-head">
        <span className="t-label">
          {row.student_label ?? 'Grup'} · {dateTime(row.created_at)}
        </span>
        <div className="row">
          {row.degraded_mode && <Badge tone="warning">Ücretsiz katman</Badge>}
          {row.schema_valid === false && <Badge tone="warning">Şema onarımı</Badge>}
          {row.escalated && <Badge tone="neutral">Hocaya iletildi</Badge>}
          {row.mode === 'direct' && <Badge tone="neutral">Doğrudan cevap</Badge>}
        </div>
      </div>
      {row.in_text && <TutorMessage from="student">{row.in_text}</TutorMessage>}
      <TutorMessage
        name="Öğrenmen"
        avatarSrc="/ds/ogrenmen-maskot.webp"
        review={{ model: row.model ?? row.provider ?? 'şablon', cost: usd(row.cost_usd), memory: row.memory_fact_ids.length, flagged: row.flagged, onFlag }}
      >
        {row.response_text}
      </TutorMessage>
      {row.flagged && row.flag_reason && <span className="hint">İşaret nedeni: {row.flag_reason}</span>}
      {note && <Notice tone="info">{note}</Notice>}
      {flagging && (
        <FlagForm
          row={row}
          ds={ctx.ds}
          onCancel={() => setFlagging(false)}
          onDone={() => {
            setFlagging(false);
            onChanged();
          }}
        />
      )}
      {row.prompt_text && (
        <details>
          <summary>Temizlenmiş prompt ({row.prompt_version ?? 'sürüm yok'})</summary>
          <pre className="legal-body">{row.prompt_text}</pre>
        </details>
      )}
    </article>
  );
}

