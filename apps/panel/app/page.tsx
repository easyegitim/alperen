'use client';
// Genel bakış (BLUEPRINT §7): StatTile ×4 + AlertRow listesi (panel_overview RPC) + "Yanıt süresi (14 gün)" grafiği.
// Sıra egitmen-paneli.md'deki gibi: kim bekliyor, kim sessiz, ne zaman teslim; grafik en sona.
import { AlertRow, Button, Notice, StatTile } from '../lib/ds';
import { sortAlerts } from '../lib/alerts';
import { alertSince } from '../lib/format';
import { useAction, useAsync } from '../lib/hooks';
import { ActionResult, Loadable, StaffPage, type StaffContext } from '../lib/shell';
import { ResponseChart } from '../components/ResponseChart';
import type { AlertItem } from '../lib/data';
import { RESPONSE_TARGET_HOURS, tileProps } from '../lib/tiles';

function telegramLink(a: AlertItem): string {
  return typeof a.ref.chat_id === 'number' ? `tg://openmessage?chat_id=${a.ref.chat_id}` : 'tg://resolve?domain=ogrenmen_bot';
}

function Overview({ ds, canEdit }: StaffContext) {
  const overview = useAsync(() => ds.overview(), [ds]);
  const alerts = useAsync(() => ds.alerts(), [ds]);
  const action = useAction();
  const now = ds.now();

  // "Cevapla": resolve_alert + tg:// (§7). "Mesaj gönder" yalnız Telegram'ı açar; uyarı, eğitmen ayrıca "Tamam" deyince kapanır
  // — Telegram kapatılıp mesaj gönderilmezse uyarı takip listesinden düşmesin.
  const resolve = async (a: AlertItem, openTelegram: boolean) => {
    const res = await action.run(() => ds.resolveAlert(a.id), openTelegram && ds.mode === 'live' ? 'Uyarı kapatıldı; Telegram açılıyor.' : 'Uyarı kapatıldı.');
    if (res.ok) {
      overview.reload();
      alerts.reload();
      if (openTelegram && typeof window !== 'undefined' && ds.mode === 'live') window.location.href = telegramLink(a);
    }
  };

  return (
    <>
      <Loadable state={overview}>
        {(o) => (
          <section className="tiles" aria-label="Özet">
            {tileProps(o.tiles).map((t) => (
              <StatTile key={t.label} {...t} />
            ))}
          </section>
        )}
      </Loadable>
      <section className="section" aria-labelledby="alerts-h">
        <h2 id="alerts-h" className="t-title-2">
          Takip listesi
        </h2>
        <ActionResult error={action.error} message={action.message} />
        <Loadable state={alerts}>
          {(list) =>
            list.length === 0 ? (
              <Notice tone="info">Açık uyarı yok.</Notice>
            ) : (
              <div className="stack">
                {sortAlerts(list).map((a) => (
                  <AlertRow
                    key={a.id}
                    kind={a.kind === 'ops' ? 'Operasyon' : a.kind}
                    severity={a.severity}
                    student={a.student_label ?? 'Grup / sistem'}
                    detail={a.detail}
                    since={alertSince(a.kind, a.since, now)}
                    action={
                      a.kind === 'unanswered' ? (
                        <Button variant="secondary" size="sm" disabled={!canEdit || action.busy} onClick={() => void resolve(a, true)}>
                          Cevapla
                        </Button>
                      ) : a.kind === 'silent' || a.kind === 'morale' || a.kind === 'deadline' ? (
                        <span className="row">
                          {canEdit ? (
                            <a className="og-btn og-btn-secondary og-btn-sm" href={telegramLink(a)}>
                              Mesaj gönder
                            </a>
                          ) : (
                            <Button variant="secondary" size="sm" disabled>
                              Mesaj gönder
                            </Button>
                          )}
                          <Button variant="quiet" size="sm" disabled={!canEdit || action.busy} onClick={() => void resolve(a, false)}>
                            Tamam
                          </Button>
                        </span>
                      ) : a.ref.lesson_id ? (
                        <a className="og-btn og-btn-secondary og-btn-sm" href={`/ders?id=${a.ref.lesson_id}`}>
                          Raporu aç
                        </a>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            )
          }
        </Loadable>
      </section>
      <Loadable state={overview}>{(o) => <ResponseChart series={o.response_series} targetHours={RESPONSE_TARGET_HOURS} />}</Loadable>
    </>
  );
}

export default function Page() {
  return <StaffPage title="Genel bakış">{(ctx) => <Overview {...ctx} />}</StaffPage>;
}
