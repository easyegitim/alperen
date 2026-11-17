import { describe, expect, it } from 'vitest';
import { allPrompts, lintPromptText, promptRegistry, stripMath } from '../src/index.js';

const TOOL_NAMES = [...new Set(allPrompts().flatMap((p) => p.meta.tools))];

describe('prompt metni kuralları', () => {
  it('her birleşik prompt ve katman temiz', () => {
    for (const p of allPrompts()) expect(lintPromptText(p.text, { toolNames: TOOL_NAMES }), `${p.meta.route}@${p.meta.version}`).toEqual([]);
    for (const k of promptRegistry().layerKeys()) expect(lintPromptText(promptRegistry().layer(k), { toolNames: TOOL_NAMES }), k).toEqual([]);
  });

  it('ihlalleri yakalar', () => {
    const rules = (t: string) => lintPromptText(t, { toolNames: ['get_mastery', 'memory'] }).map((i) => i.rule);
    expect(rules('Harika!')).toContain('no-exclamation');
    expect(rules('Faktöriyel $5!$ matematiktir.')).toEqual([]);
    expect(rules('Selam 🙂')).toContain('no-emoji');
    expect(rules('Bunu ASLA yapma.')).toContain('no-pressure-caps');
    expect(rules('Bu ÖNEMLİ bir kural.')).toContain('no-pressure-caps');
    expect(rules('- Örnek satır')).toContain('examples-labeled');
    expect(rules('You MUST answer.')).toContain('no-pressure-caps');
    expect(rules('Önce adım adım düşün.')).toContain('no-scaffold');
    expect(rules('get_mastery aracını çağır.')).toContain('no-tool-names');
    expect(rules('memory dosyasına yaz.')).toContain('no-tool-names');
    expect(rules('/memories/profile.md dosyasına bak.')).toEqual([]);
    expect(rules('Örnek yanıt: merhaba')).toContain('examples-labeled');
    expect(rules('Örnek yanıt (örnektir): merhaba')).toEqual([]);
    expect(rules('## Örnekler\nx')).toContain('examples-labeled');
  });

  it('matematik ayıklama', () => {
    expect(stripMath('a $x!$ b $$y!$$ c')).not.toContain('!');
  });

  it('koç promptu üç modu, mod önerisini ve hocaya yönlendirmeyi anlatır', () => {
    const t = allPrompts().find((p) => p.meta.route === 'coach_chat')?.text ?? '';
    for (const s of ['İpucu modunda', 'Açıkla modunda', 'Çözümü göster modunda', 'Modu sen değiştiremezsin', 'hocana sorman daha iyi']) {
      expect(t).toContain(s);
    }
  });

  it('teşhis promptu beş hata nedenini ve alt kazanım önerisini tanımlar', () => {
    const t = allPrompts().find((p) => p.meta.route === 'solution_diagnosis')?.text ?? '';
    for (const s of ['concept:', 'procedure:', 'careless:', 'reading:', 'time:', 'proposed_subskill', 'why_tr', 'reference_solution_steps']) {
      expect(t).toContain(s);
    }
  });
});
