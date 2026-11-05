/**
 * Not üretimi eval'i (eval/notes_generation): vakalar, betik yanıtların sözleşmeye uyması, kurucuyla tutarlılık ve
 * puanlayıcının olumsuz durumları (uydurulmuş tarih, izinsiz modül, eksik anahtar, ünlem).
 */
import { readFileSync } from 'node:fs';
import { documentAst } from '@ogrenmen/contracts';
import { describe, expect, it } from 'vitest';
import { figureCodeIssues, loadEvalCases, scoreNotes, type NotesOutput } from '../src/eval/index.js';

const content = (f: string) => JSON.parse(readFileSync(new URL(`../../../content/tyt-matematik/${f}`, import.meta.url), 'utf8'));
const LEAVES = new Set((content('skills.json') as { id: string; is_leaf: boolean }[]).filter((s) => s.is_leaf).map((s) => s.id));
const TAGS = new Set((content('misconception-tags.json') as { tag: string }[]).map((t) => t.tag));

const cases = loadEvalCases({ route: 'notes_generation' }).filter((c) => c.route === 'notes_generation');
type NotesCase = Extract<(typeof cases)[number], { route: 'notes_generation' }>;
const reply = (c: NotesCase) => structuredClone(c.fake_reply[0]?.json) as NotesOutput;

describe('notes_generation eval seti', () => {
  it('2 vaka: kişisel (örüntülü) ve genel (örüntüsüz)', () => {
    expect(cases.map((c) => c.id)).toEqual(['ng-01-rasyonel-kisisel', 'ng-02-uslu-genel']);
    expect(cases.map((c) => (c as NotesCase).expected.personalized)).toEqual([true, false]);
  });

  it('betik yanıtlar document-ast\'ten geçer; kodlar içerik deposunda; girdide <note_request> ve <patterns>', () => {
    for (const c of cases as NotesCase[]) {
      const r = documentAst.safeParse(c.fake_reply[0]?.json);
      expect(r.success, `${c.id}: ${r.success ? '' : JSON.stringify(r.error.issues.slice(0, 3))}`).toBe(true);
      for (const s of c.expected.skills_any) expect(LEAVES.has(s), s).toBe(true);
      for (const p of c.expected.patterns) if (p.source === 'misconception') expect(TAGS.has(p.id), p.id).toBe(true);
      expect(c.input.user).toContain('<note_request>');
      expect(c.input.user).toContain('<patterns>');
      const out = reply(c);
      for (const b of out.blocks) if (b.type === 'common_mistake_callout' && !b.pattern_ref) expect(TAGS.has(String(b.pattern_id)), String(b.pattern_id)).toBe(true);
      expect(scoreNotes(c, out).pass).toBe(true);
    }
  });

  it('uydurulmuş tarih, eksik anahtar ve ünlem puanı düşürür', () => {
    const c = cases[0] as NotesCase;
    const out = reply(c);
    const callout = out.blocks.find((b) => b.type === 'common_mistake_callout') as unknown as { pattern_ref: { date: string }; text: string };
    callout.pattern_ref.date = '2026-10-01';
    callout.text = `${callout.text} Hadi bakalım!`;
    out.keys = out.keys.slice(1);
    const s = scoreNotes(c, out);
    expect(s.pass).toBe(false);
    const failed = s.checks.filter((x) => !x.pass).map((x) => x.name);
    expect(failed).toEqual(expect.arrayContaining(['hata kutuları gerçek örüntülere başvurur', 'her sorunun SymPy anahtarı', 'ünlem yok']));
  });

  it('genel notta kişisel başvuru düşer', () => {
    const c = cases[1] as NotesCase;
    const out = reply(c);
    // Genel notta hata kutusu yok (fikstür paragraf kullanır); başvurulu bir kutu eklenince denetim düşürmeli.
    out.blocks.push({
      type: 'common_mistake_callout',
      id: 'b99',
      section_no: 2,
      pattern_id: 'uslu.usleri-carpma',
      pattern_ref: { source: 'misconception', id: 'uslu.usleri-carpma', date: '2026-11-01' },
      text: 'Bu konuda sık yapılan bir hata.',
    });
    expect(scoreNotes(c, out).checks.find((x) => x.name === 'hata kutuları gerçek örüntülere başvurur')?.pass).toBe(false);
  });

  it('figür kodu kuralları', () => {
    expect(figureCodeIssues('import numpy as np\nfig, ax = plt.subplots()\nsave_figure(fig, 2)', 'matplotlib', 2)).toEqual([]);
    expect(figureCodeIssues('import os\nsave_figure(fig, 1)', 'matplotlib', 1)).toEqual(['izinsiz modül: os']);
    expect(figureCodeIssues('x = np.random.rand(3)\nsave_figure(fig, 1)', 'matplotlib', 1)).toHaveLength(1);
    expect(figureCodeIssues('save_figure(fig, 1)', 'matplotlib', 2)).toEqual(['save_figure(fig, 2) yok']);
    expect(figureCodeIssues('<svg><script>x</script></svg>', 'svg', 1)).toEqual(['betik ya da dış bağlantı']);
  });
});
