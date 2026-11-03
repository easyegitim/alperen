/**
 * `public.render_dossier()` yapısal JSON'unu geçidin dossier system bloğuna (system[2]) dönüştürür.
 * Deterministik: aynı JSON her zaman aynı metni verir (önbellek önekini bozmaz); görünen ad yoktur, öğrenci
 * yalnız `public_ref` ile anılır; tarihler gün hassasiyetindedir (docs/PLAN-v2.md §3.3-3.4).
 */
type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}
function arr(v: unknown): Obj[] {
  return Array.isArray(v) ? v.map(obj) : [];
}
function s(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}
function n2(v: unknown): string | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v.toFixed(2);
}
function list(v: unknown): string {
  return Array.isArray(v) && v.length > 0 ? v.map(String).join(', ') : '-';
}
function kv(pairs: Array<[string, unknown]>): string {
  return pairs
    .map(([k, v]) => [k, s(v)] as const)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}

const CAUSES: Array<[string, string]> = [
  ['concept', 'kavram'],
  ['procedure', 'işlem'],
  ['careless', 'dikkat'],
  ['reading', 'okuma'],
  ['time', 'süre'],
];

export function renderDossierText(dossier: unknown): string {
  const d = obj(dossier);
  const id = obj(d.identity);
  const mastery = obj(d.mastery);
  const lines: string[] = [];

  lines.push(`# Öğrenci dosyası (kayıt: ${s(id.student_ref) ?? '-'}) — ${s(d.as_of) ?? '-'}`);
  lines.push(kv([['Sınıf', id.grade], ['Okul', id.school]]));
  lines.push(
    kv([
      ['Ders', [s(id.course_code), s(id.course_title)].filter(Boolean).join(' ')],
      ['Müfredat', id.curriculum],
      ['Dönem', id.period],
      ['Hedef sınav', id.target_exam],
      ['Sınav tarihi', id.exam_date],
      ['Kalan gün', id.days_to_exam],
      ['Hedef', id.goal],
    ]),
  );

  lines.push('', '## Ustalık');
  lines.push(
    kv([
      ['Kanıtlı yaprak', `${s(mastery.leaves_with_evidence) ?? 0}/${s(mastery.leaves_total) ?? 0}`],
      ['Toplam kanıt', mastery.evidence_total],
    ]),
  );
  const leaf = (x: Obj) => {
    const trend = n2(x.trend_14d);
    return `- ${s(x.skill_id) ?? '?'} ${s(x.name) ?? ''} p=${n2(x.p) ?? '-'} n=${s(x.n) ?? 0}${trend !== null ? ` eğilim14g=${trend}` : ''}`;
  };
  const weakest = arr(mastery.weakest);
  const strongest = arr(mastery.strongest);
  lines.push('En zayıf yapraklar:', ...(weakest.length ? weakest.map(leaf) : ['- (yok)']));
  lines.push('En güçlü yapraklar:', ...(strongest.length ? strongest.map(leaf) : ['- (yok)']));

  lines.push('', '## Açık yanılgılar');
  const misc = arr(d.open_misconceptions);
  lines.push(
    ...(misc.length
      ? misc.map((m) => `- ${s(m.tag) ?? '?'} (${s(m.skill_id) ?? '-'}) kanıt=${s(m.evidence) ?? 0} son=${s(m.last_seen) ?? '-'}${s(m.text) ? `: ${s(m.text)}` : ''}`)
      : ['- (yok)']),
  );

  lines.push('', '## Hata nedenleri (son 30 gün)');
  const causes = obj(d.error_causes_30d);
  lines.push(CAUSES.map(([k, tr]) => `${tr}: ${s(causes[k]) ?? 0}`).join(' · '));

  lines.push('', '## Son teşhisler');
  const diag = arr(d.recent_diagnoses);
  lines.push(
    ...(diag.length
      ? diag.map(
          (x) =>
            `- ${s(x.date) ?? '-'} ${s(x.source) ?? '-'} ${s(x.verdict) ?? '-'}${s(x.error_cause) ? ` neden=${s(x.error_cause)}` : ''}${s(x.failing_step_no) ? ` adım=${s(x.failing_step_no)}` : ''} beceri=${list(x.skill_ids)} yanılgı=${list(x.misconception_tags)}`,
        )
      : ['- (yok)']),
  );

  lines.push('', '## Son denemeler');
  const exams = arr(d.recent_exams);
  lines.push(
    ...(exams.length
      ? exams.map((e) => `- ${s(e.date) ?? '-'} ${s(e.title) ?? '-'} (${s(e.kind) ?? '-'}) net=${s(e.net) ?? '-'} doğru=${s(e.correct) ?? '-'} yanlış=${s(e.wrong) ?? '-'} boş=${s(e.blank) ?? '-'}`)
      : ['- (yok)']),
  );

  lines.push('', '## Soru tarzı boşlukları');
  const gaps = arr(d.style_gaps);
  lines.push(...(gaps.length ? gaps.map((g) => `- ${s(g.code) ?? '?'} ${s(g.name) ?? ''} sıklık=${s(g.frequency) ?? '-'} görülen=${s(g.seen) ?? 0} doğru=${s(g.correct) ?? 0}`) : ['- (yok)']));

  lines.push('', '## Onaylı ders gözlemleri');
  const claims = arr(d.recent_lesson_claims);
  lines.push(...(claims.length ? claims.map((c) => `- ${s(c.date) ?? '-'} ${s(c.kind) ?? '-'} ${s(c.skill_id) ?? '-'}: ${s(c.value) ?? '-'}`) : ['- (yok)']));

  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n') + '\n';
}
