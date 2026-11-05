/**
 * P6 veli rotaları: parent_chat (Sonnet 5.5 · low, between_tools), request_report strict şeması (supabase 0043
 * parent_request_report türleriyle birebir), report (report-ast) ve notification_copy (Haiku) sahte fikstürleri.
 */
import { describe, expect, it } from 'vitest';
import { contractRegistry, type Contract } from '@ogrenmen/contracts';
import { requestReportInput } from '../src/tools.js';
import { COURSE, DOSSIER, PRODUCT, setup } from './helpers.js';

describe('veli rotaları', () => {
  it('parent_chat: Sonnet 5.5 · low, düşünme yalnız araç turları arasında, akış', () => {
    const { gateway } = setup();
    const b = gateway.buildRequest('parent_chat', { system: { product: PRODUCT, course: COURSE, dossier: DOSSIER }, user: 'Bu hafta nasıl?' });
    expect(b.model).toBe('claude-sonnet-5-5');
    expect(b.output_config).toEqual({ effort: 'low' });
    expect(b.thinking).toEqual({ type: 'between_tools' });
  });

  it('request_report: türler RPC ile aynı; strict şemada enum korunur, yalnız kind zorunlu', () => {
    const { gateway } = setup();
    const b = gateway.buildRequest('parent_chat', { system: { product: PRODUCT }, user: 'rapor' });
    const t = (b.tools as unknown as { name: string; input_schema: { properties: Record<string, { enum?: string[] }>; required?: string[]; additionalProperties: boolean } }[]).find(
      (x) => x.name === 'request_report',
    )!;
    expect(t.input_schema.properties.kind?.enum).toEqual(['weekly', 'exam', 'topic', 'trend', 'custom']);
    expect(t.input_schema.required).toEqual(['kind']);
    expect(t.input_schema.additionalProperties).toBe(false);
    expect(requestReportInput.safeParse({ kind: 'trend', weeks: 6 }).success).toBe(true);
    expect(requestReportInput.safeParse({ kind: 'trend', weeks: 40 }).success).toBe(false);
    expect(requestReportInput.safeParse({ topic: 'x', period: 'week' }).success).toBe(false);
  });

  it('sahte fikstürler: report → report-ast (3 bölüm, anahtar yok); notification_copy eşlemeli haftalık metin', async () => {
    const { gateway } = setup();
    const rep = await gateway.call('report', { system: { product: PRODUCT }, user: '<report_request>\n{}\n</report_request>' });
    expect((contractRegistry['report-ast'] as Contract).isValid(rep.data)).toBe(true);
    const ast = rep.data as { sections: unknown[]; keys: unknown[]; blocks: { type: string; data_ref?: string }[] };
    expect(ast.sections).toHaveLength(3);
    expect(ast.keys).toEqual([]);
    expect(ast.blocks.filter((x) => x.type === 'chart').map((x) => x.data_ref)).toEqual(['daily_time', 'skill_bands']);
    const weekly = await gateway.call('notification_copy', { system: { product: PRODUCT }, user: '<notification>\n{"kind":"weekly_summary"}\n</notification>' });
    expect(weekly.data).toMatchObject({ title: 'Haftalık özet hazır', action_label: 'Aç' });
    const other = await gateway.call('notification_copy', { system: { product: PRODUCT }, user: '<notification>\n{"kind":"inactivity"}\n</notification>' });
    expect(other.data).toMatchObject({ title: 'Yeni bir bildirim' });
  });
});
