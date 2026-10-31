'use client';
// "Soru ekle": source='instructor' madde + set_answer_key (BLUEPRINT §7 kuyruk). Eğitmenin yazdığı anahtar "anahtar görüldü" kanıtı sayılır.
import * as React from 'react';
import { Button, TextField } from '../../lib/ds';
import { useAction, useAsync } from '../../lib/hooks';
import { ActionResult, type StaffContext } from '../../lib/shell';

const KEYS = ['A', 'B', 'C', 'D'] as const;

export function AddQuestion({ ctx, onAdded }: { ctx: StaffContext; onAdded: () => void }) {
  const skills = useAsync(() => ctx.ds.skills(), [ctx.ds]);
  const [skill, setSkill] = React.useState('');
  const [stem, setStem] = React.useState('');
  const [options, setOptions] = React.useState<string[]>(['', '', '', '']);
  const [correct, setCorrect] = React.useState('');
  const [solution, setSolution] = React.useState('');
  const action = useAction();
  const ready = ctx.canEdit && skill && stem.trim() && options.every((o) => o.trim()) && correct && solution.trim();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await action.run(
      () =>
        ctx.ds.addQuestion({
          skill_id: skill,
          stem: stem.trim(),
          options: KEYS.map((k, i) => ({ key: k, text: options[i].trim(), misconception_tag: null })),
          correct_option: correct,
          solution: solution.trim(),
          difficulty: 0.5,
        }),
      'Soru taslak olarak eklendi ve kuyruğa düştü.',
    );
    if (r.ok) {
      setStem('');
      setOptions(['', '', '', '']);
      setCorrect('');
      setSolution('');
      onAdded();
    }
  };
  return (
    <form className="form" onSubmit={(e) => void submit(e)} aria-labelledby="add-q-h">
      <h2 id="add-q-h" className="t-title-2">
        Soru ekle
      </h2>
      <div className="field">
        <label htmlFor="q-skill">Kazanım</label>
        <select id="q-skill" value={skill} onChange={(e) => setSkill(e.target.value)} disabled={!ctx.canEdit} required>
          <option value="">Seç</option>
          {(skills.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="q-stem">Soru kökü</label>
        <textarea id="q-stem" value={stem} onChange={(e) => setStem(e.target.value)} disabled={!ctx.canEdit} required />
      </div>
      {KEYS.map((k, i) => (
        <TextField
          key={k}
          label={`Şık ${k}`}
          value={options[i]}
          disabled={!ctx.canEdit}
          onChange={(e) => setOptions((o) => o.map((x, j) => (j === i ? e.target.value : x)))}
          required
        />
      ))}
      <div className="field">
        <label htmlFor="q-correct">Doğru şık</label>
        <select id="q-correct" value={correct} onChange={(e) => setCorrect(e.target.value)} disabled={!ctx.canEdit} required>
          <option value="">Seç</option>
          {KEYS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="q-solution">Çözüm</label>
        <textarea id="q-solution" value={solution} onChange={(e) => setSolution(e.target.value)} disabled={!ctx.canEdit} required />
      </div>
      <div className="row">
        <Button variant="secondary" type="submit" disabled={!ready || action.busy}>
          Soruyu ekle
        </Button>
      </div>
      <ActionResult error={action.error} message={action.message} />
    </form>
  );
}
