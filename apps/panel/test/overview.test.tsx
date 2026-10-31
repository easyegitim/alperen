import { describe, expect, it } from 'vitest';
import { fireEvent, within } from '@testing-library/react';
import OverviewPage from '../app/page';
import { sortAlerts } from '../lib/alerts';
import { tileProps } from '../lib/tiles';
import { buttonsNamed, primaryCount, readJson, renderPage } from './helpers';

describe('genel bakış', () => {
  it('overview_orders_alerts_by_severity_then_age', async () => {
    const sorted = sortAlerts([
      { id: 'a', severity: 'neutral', since: '2026-10-01T00:00:00Z' },
      { id: 'b', severity: 'warning', since: '2026-10-19T00:00:00Z' },
      { id: 'c', severity: 'danger', since: '2026-10-18T18:00:00Z' },
      { id: 'd', severity: 'warning', since: '2026-10-10T00:00:00Z' },
      { id: 'e', severity: 'danger', since: '2026-10-18T16:00:00Z' },
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['e', 'c', 'd', 'b', 'a']);

    const { container } = await renderPage(OverviewPage, { role: 'coordinator' });
    const rows = [...container.querySelectorAll('.og-alert')];
    const words = rows.map((r) => r.querySelector('.og-badge')?.textContent);
    expect(words).toEqual(['Acil', 'Acil', 'Dikkat', 'Dikkat', 'Bilgi']);
    // Acil grubu içinde en eski üstte
    const fx = readJson<{ alerts: { severity: string; since: string; detail: string }[] }>('fixtures/panel/overview.json');
    const danger = fx.alerts.filter((a) => a.severity === 'danger').sort((a, b) => a.since.localeCompare(b.since));
    expect(rows[0].textContent).toContain(danger[0].detail);
    expect(rows[1].textContent).toContain(danger[1].detail);
    expect(rows[0].querySelector('.og-alert-since')?.textContent).toBe('41 saattir cevapsız');
    expect(primaryCount(container)).toBeLessThanOrEqual(1);
  });

  it('stat_tile_shows_status_word', async () => {
    const tiles = tileProps({ unanswered: 2, silent: 1, deadlines: 1, response_hours: 1.4 });
    expect(tiles[0]).toMatchObject({ status: 'danger', statusText: 'Acil' });
    expect(tiles[1]).toMatchObject({ status: 'warning', statusText: 'Dikkat' });
    expect(tiles[2]).not.toHaveProperty('status');
    expect(tiles[3]).toMatchObject({ status: 'success', statusText: 'Hedefte', hint: 'hedef 2 saat', value: '1,4 saat' });
    expect(tileProps({ unanswered: 0, silent: 0, deadlines: 0, response_hours: 3 })[3]).toMatchObject({ status: 'warning', statusText: 'Dikkat' });
    expect(tileProps({ unanswered: 0, silent: 0, deadlines: 0, response_hours: 3 })[0]).not.toHaveProperty('statusText');

    const { container } = await renderPage(OverviewPage, { role: 'coordinator' });
    const stats = [...container.querySelectorAll('.og-stat')];
    expect(stats).toHaveLength(4);
    const byLabel = (l: string) => stats.find((s) => s.querySelector('.og-stat-label')?.textContent === l)!;
    expect(within(byLabel('Cevapsız soru') as HTMLElement).getByText('Acil')).toBeTruthy();
    expect(within(byLabel('Sessiz öğrenci') as HTMLElement).getByText('Dikkat')).toBeTruthy();
    expect(within(byLabel('Ort. yanıt süresi') as HTMLElement).getByText('Hedefte')).toBeTruthy();
    expect(byLabel('Yaklaşan teslim').querySelector('.og-badge')).toBeNull();
  });

  it('resolving an alert updates the list and tiles (resolve_alert)', async () => {
    const { container } = await renderPage(OverviewPage, { role: 'instructor' });
    const before = container.querySelectorAll('.og-alert').length;
    const [answer] = buttonsNamed(container, /^Cevapla$/);
    fireEvent.click(answer);
    await within(container).findByText('Uyarı kapatıldı.');
    expect(container.querySelectorAll('.og-alert').length).toBe(before - 1);
  });

  it('"Mesaj gönder" only opens Telegram; the alert closes with a separate "Tamam"', async () => {
    const { container } = await renderPage(OverviewPage, { role: 'coordinator' });
    const before = container.querySelectorAll('.og-alert').length;
    const send = [...container.querySelectorAll<HTMLAnchorElement>('a')].filter((a) => a.textContent === 'Mesaj gönder');
    expect(send.length).toBeGreaterThan(0);
    expect(send.every((a) => a.getAttribute('href')!.startsWith('tg://'))).toBe(true);
    // bağlantıya tıklamak uyarıyı kapatmaz (mesaj gerçekten gönderilmemiş olabilir)
    expect(buttonsNamed(container, /^Mesaj gönder$/)).toEqual([]);
    const ok = buttonsNamed(container, /^Tamam$/);
    expect(ok.length).toBe(send.length);
    fireEvent.click(ok[0]);
    await within(container).findByText('Uyarı kapatıldı.');
    expect(container.querySelectorAll('.og-alert').length).toBe(before - 1);
  });

  it('chart has a table view and only one series', async () => {
    const { container } = await renderPage(OverviewPage, { role: 'coordinator' });
    expect(container.querySelectorAll('svg.chart').length).toBe(1);
    expect(container.querySelectorAll('svg.chart circle.endpoint').length).toBe(1);
    expect(container.querySelector('details table')?.querySelectorAll('tbody tr').length).toBe(14);
  });
});
