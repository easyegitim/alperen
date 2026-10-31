'use client';
// Maliyet (BLUEPRINT §7 maliyet/page.tsx; koordinatör): spend_ledger gün/ay iki sütun — "Sohbet ve toplu işler" (tavana sayılan) ve
// "Ders analizi" (cap_excluded_purposes; kendi lesson_monthly_cap_usd çubuğu; öğrenci başına maliyete dahil değil),
// sağlayıcı payı, tavan bayrakları (set_runtime_flag; paid_llm_enabled true'ya dönüş yalnız buradan), tablo boyutları, havuz isabeti,
// "Pilot ölçütleri" (pilot_metrics; null → "henüz ölçülmedi") ve "Pilot kapısı" (settings.pilot_gate; kulaklik metrics --gate ile aynı mantık).
import * as React from 'react';
import { Badge, Button, Notice, ProgressBar, TextField } from '../../lib/ds';
import { dayMonth, decimal, percent, usd } from '../../lib/format';
import { METRIC_LABELS, ciStatusFromMetrics, evaluatePilotGate } from '../../lib/pilot-gate';
import { useAction, useAsync } from '../../lib/hooks';
import { ActionResult, Loadable, StaffPage, type StaffContext } from '../../lib/shell';
import type { PilotMetricRow, SpendView } from '../../lib/data';
import { GateBlock } from '../../components/GateBlock';

const STATE_TEXT: Record<string, { tone: 'success' | 'warning' | 'danger'; text: string }> = {
  normal: { tone: 'success', text: 'Normal' },
  free_only: { tone: 'warning', text: 'Yalnız ücretsiz katman' },
  degraded: { tone: 'danger', text: 'Bozulmuş mod' },
};

function metricValue(m: PilotMetricRow): string {
  if (m.value === null) return 'henüz ölçülmedi';
  if (m.metric === 'cost_per_student') return usd(m.value);
  if (m.metric === 'priority_uplift') return decimal(m.value, 2);
  return percent(m.value);
}

function Ledger({ view }: { view: SpendView }) {
  const excluded = (view.flags.cap_excluded_purposes as string[] | undefined) ?? [];
  const days = [...new Set(view.ledger.map((r) => r.day))].sort();
  const sumFor = (rows: typeof view.ledger) => rows.reduce((a, r) => a + r.cost_usd, 0);
  const chat = (day?: string) => sumFor(view.ledger.filter((r) => !excluded.includes(r.purpose) && (!day || r.day === day)));
  const lesson = (day?: string) => sumFor(view.ledger.filter((r) => excluded.includes(r.purpose) && (!day || r.day === day)));
  const providers = [...new Set(view.ledger.filter((r) => !excluded.includes(r.purpose)).map((r) => r.provider))].sort();
  const chatTotal = chat();
  return (
    <>
      <section className="section" aria-labelledby="ledger-h">
        <h2 id="ledger-h" className="t-title-2">
          Harcama ({view.month})
        </h2>
        <table className="table">
          <thead>
            <tr>
              <th>Gün</th>
              <th className="num">Sohbet ve toplu işler</th>
              <th className="num">Ders analizi</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d}>
                <td>{dayMonth(`${d}T12:00:00Z`)}</td>
                <td className="num">{usd(chat(d))}</td>
                <td className="num">{usd(lesson(d))}</td>
              </tr>
            ))}
            <tr>
              <th>Ay toplamı</th>
              <th className="num">{usd(chatTotal)}</th>
              <th className="num">{usd(lesson())}</th>
            </tr>
          </tbody>
        </table>
        <span className="hint">Ders analizi ayrı bütçededir: sohbet tavanına sayılmaz ve öğrenci başına maliyete dahil edilmez.</span>
      </section>
      <section className="section" aria-labelledby="share-h">
        <h2 id="share-h" className="t-title-2">
          Sağlayıcı payı (sohbet ve toplu işler)
        </h2>
        <table className="table">
          <thead>
            <tr>
              <th>Sağlayıcı</th>
              <th className="num">Çağrı</th>
              <th className="num">Tutar</th>
              <th className="num">Pay</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => {
              const rows = view.ledger.filter((r) => r.provider === p && !excluded.includes(r.purpose));
              const cost = sumFor(rows);
              return (
                <tr key={p}>
                  <td>{p}</td>
                  <td className="num">{rows.reduce((a, r) => a + r.calls, 0)}</td>
                  <td className="num">{usd(cost)}</td>
                  <td className="num">{chatTotal > 0 ? percent(cost / chatTotal) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

function Caps({ ctx, view, onChanged }: { ctx: StaffContext; view: SpendView; onChanged: () => void }) {
  const action = useAction();
  const [daily, setDaily] = React.useState(String(view.flags.daily_cap_usd ?? ''));
  const [monthly, setMonthly] = React.useState(String(view.flags.monthly_cap_usd ?? ''));
  const paid = view.flags.paid_llm_enabled !== false;
  const c = view.check;
  const setFlag = async (key: string, value: unknown, msg: string) => {
    const r = await action.run(() => ctx.ds.setFlag(key, value), msg);
    if (r.ok) onChanged();
  };
  const saveCaps = async (e: React.FormEvent) => {
    e.preventDefault();
    const d = Number(daily.replace(',', '.'));
    const m = Number(monthly.replace(',', '.'));
    if (!(d > 0) || !(m > 0)) {
      action.setError('Tavanlar sıfırdan büyük olmalı.');
      return;
    }
    const r1 = await action.run(() => ctx.ds.setFlag('daily_cap_usd', d));
    if (!r1.ok) return;
    const r2 = await action.run(() => ctx.ds.setFlag('monthly_cap_usd', m), 'Tavanlar kaydedildi.');
    if (r2.ok) onChanged();
  };
  return (
    <section className="section" aria-labelledby="caps-h">
      <h2 id="caps-h" className="t-title-2">
        Tavanlar ve durum
      </h2>
      <div className="row">
        <span>Sohbet durumu:</span>
        <Badge tone={STATE_TEXT[c.state]?.tone ?? 'warning'}>{STATE_TEXT[c.state]?.text ?? c.state}</Badge>
        <Badge tone={paid ? 'success' : 'warning'}>{paid ? 'Ücretli model açık' : 'Ücretli model kapalı'}</Badge>
      </div>
      <ProgressBar value={c.day_usd} max={c.daily_cap || 1} label="Bugün (sohbet ve toplu işler)" valueText={`${usd(c.day_usd)} / ${usd(c.daily_cap)}`} />
      <ProgressBar value={c.month_usd} max={c.monthly_cap || 1} label="Bu ay (sohbet ve toplu işler)" valueText={`${usd(c.month_usd)} / ${usd(c.monthly_cap)}`} />
      <ProgressBar value={c.lesson_month_usd} max={c.lesson_cap || 1} label="Bu ay (ders analizi, ayrı tavan)" valueText={`${usd(c.lesson_month_usd)} / ${usd(c.lesson_cap)}`} tone="gold" />
      <div className="row">
        {paid ? (
          <Button variant="secondary" disabled={action.busy} onClick={() => void setFlag('paid_llm_enabled', false, 'Ücretli model kapatıldı; sohbet ücretsiz katmana iner.')}>
            Ücretli modeli kapat
          </Button>
        ) : (
          <Button variant="secondary" disabled={action.busy} onClick={() => void setFlag('paid_llm_enabled', true, 'Ücretli model yeniden açıldı.')}>
            Ücretli modeli yeniden aç
          </Button>
        )}
        <Button
          variant="quiet"
          disabled={action.busy}
          onClick={() => void setFlag('degraded_mode', view.flags.degraded_mode !== true, view.flags.degraded_mode === true ? 'Bozulmuş mod kapatıldı.' : 'Bozulmuş mod açıldı.')}
        >
          {view.flags.degraded_mode === true ? 'Bozulmuş modu kapat' : 'Bozulmuş modu aç'}
        </Button>
      </div>
      <span className="hint">Maliyet bekçisi ücretli modeli yalnız kapatabilir; yeniden açmak yalnız buradan, koordinatörle olur.</span>
      <form className="form-row" onSubmit={(e) => void saveCaps(e)} aria-label="Tavanlar">
        <TextField label="Günlük yumuşak tavan ($)" inputMode="decimal" value={daily} onChange={(e) => setDaily(e.target.value)} />
        <TextField label="Aylık sert tavan ($)" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        <div className="field">
          <span className="field-label">&nbsp;</span>
          <Button variant="secondary" type="submit" disabled={action.busy}>
            Tavanları kaydet
          </Button>
        </div>
      </form>
      <ActionResult error={action.error} message={action.message} />
    </section>
  );
}

function Storage({ view }: { view: SpendView }) {
  return (
    <section className="section" aria-labelledby="storage-h">
      <h2 id="storage-h" className="t-title-2">
        Tablo boyutları ve havuz
      </h2>
      {view.table_sizes.length === 0 ? (
        <Notice tone="info">Tablo boyutu ölçümü henüz yok; gece compute_table_sizes yazar.</Notice>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Tablo</th>
              <th className="num">Boyut</th>
              <th className="num">Satır (yaklaşık)</th>
            </tr>
          </thead>
          <tbody>
            {[...view.table_sizes]
              .sort((a, b) => b.total_bytes - a.total_bytes)
              .map((t) => (
                <tr key={t.table_name}>
                  <td className="mono">{t.table_name}</td>
                  <td className="num">{decimal(t.total_bytes / 1024 / 1024, 1)} MB</td>
                  <td className="num">{t.row_estimate ?? '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
      <span>
        Onaylı havuz açıklaması: {view.pool.approved} · onay bekleyen: {view.pool.pending} · toplam isabet: {view.pool.hits}
      </span>
    </section>
  );
}

function Cost(ctx: StaffContext) {
  const view = useAsync(() => ctx.ds.spend(), [ctx.ds]);
  return (
    <Loadable state={view}>
      {(v) => (
        <>
          <Ledger view={v} />
          <Caps ctx={ctx} view={v} onChanged={view.reload} />
          <Storage view={v} />
          <section className="section" aria-labelledby="pilot-h">
            <h2 id="pilot-h" className="t-title-2">
              Pilot ölçütleri
            </h2>
            <table className="table">
              <tbody>
                {v.pilot_metrics.map((m) => (
                  <tr key={`${m.metric}:${m.period}`}>
                    <td>{METRIC_LABELS[m.metric] ?? m.metric}</td>
                    <td className="num">{metricValue(m)}</td>
                    <td className="muted">{dayMonth(`${m.period}T12:00:00Z`)} haftası</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <GateBlock gate={evaluatePilotGate(v.pilot_gate, v.pilot_metrics, ciStatusFromMetrics(v.pilot_metrics))} />
        </>
      )}
    </Loadable>
  );
}

export default function Page() {
  return (
    <StaffPage title="Maliyet" roles={['coordinator']}>
      {(ctx) => <Cost {...ctx} />}
    </StaffPage>
  );
}
