/**
 * Ders analizinin (lesson-analysis v2) model sonrası denetimi. Şema geçitte doğrulanır; burada ders bağlamına
 * uygunluk denetlenir ve düzeltilir:
 *
 *   - her alıntı (kanıt, soru, tereddüt) transkriptte aynen geçer (büyük/küçük harf, boşluk ve `…`/`...` kısaltması
 *     gözetilmez); geçmeyen kanıt düşer, kanıtı kalmayan kazanım/yanılgı iddiası düşer (uydurma alıntı dossier'e girmez)
 *   - zaman damgaları dersin süresi içinde; kazanımlar müfredatın yaprakları; önceki yanılgı takibi yalnız açık
 *     yanılgılar için
 *   - model metinlerinde ad tokenı kalırsa deterministik temizlenir (son kemer: kareler temizlenmeden gider)
 *   - öğrencinin göreceği metinlerde (text_student, for_student, taahhüt metni) sınav/sonuç öngörüsü, güvence sözü,
 *     ünlem ve yüzde yok (ürün ilkesi; "önce sonucu tahmin et" gibi olağan pedagoji serbest); varsa çağıran bir onarım
 *     turu ister. Yine varsa ders düşmez (`settleStudentTexts`): sorunlu söz kaldırılır, diğer metinler zaten eğitmen
 *     incelemesinden geçer (sonraki adım, ödev ve yanılgı iddiaları boş güvenle yazılır)
 *
 * `lesson_ref`, `student_ref`, `duration_min` ve `model_notes` modelden alınmaz, hattın değerleridir.
 */
import type { LessonAnalysis } from '@ogrenmen/contracts';
import { hmsSeconds, lessonText } from '@ogrenmen/prompts';
import { scrubText, type NameHashes } from './names.js';

export interface AnalysisContext {
  lessonRef: string;
  studentRef: string;
  durationMin: number | null;
  /** Saniye: alıntı zamanları bunun (+5 sn) içinde olmalı. */
  maxSec: number;
  /** Transkript bölüm metinleri (modele giden biçimde). */
  texts: readonly string[];
  leaves: ReadonlySet<string>;
  openMisconceptionIds: ReadonlySet<string>;
  names: NameHashes;
}

export interface AnalysisReport {
  quotesDropped: number;
  itemsDropped: number;
  namesScrubbed: number;
  /** Öğrenciye giden metin sorunları (onarım turu ister). */
  studentTextIssues: string[];
}

/** Sınav/sonuç öngörüsü ve güvence sözü (yalnız bunlar; "tahmin et", "kesir" gibi olağan sözler serbest). */
const FORBIDDEN =
  /(^|[^\p{L}])(sınavda\s+(?:\S+\s+)?çıkacak|kesin(?:likle)?\s+(?:çıkar|çıkacak|geçer|geçersin|alırsın|yaparsın|başarırsın)|garanti\p{L}*|(?:not|puan|net)\s+tahmin\p{L}*)/iu;

function fold(s: string): string {
  return s.toLocaleLowerCase('tr').normalize('NFC').replace(/[\s\u00a0]+/g, ' ').trim();
}

/** Alıntı transkriptte var mı: `…`/`...` ile bölünmüş parçalar sırayla ve tek bir bölüm içinde geçmeli. */
export function quoteInTranscript(quote: string | null | undefined, folded: readonly string[]): boolean {
  if (!quote) return false;
  const parts = fold(lessonText(quote))
    .split(/\s*(?:…|\.\.\.)\s*/u)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return false;
  return folded.some((seg) => {
    let from = 0;
    for (const p of parts) {
      const i = seg.indexOf(p, from);
      if (i < 0) return false;
      from = i + p.length;
    }
    return true;
  });
}

type Ev = { speaker: 'ÖĞRENCİ' | 'EĞİTMEN'; quote: string; t: string; t_end?: string | undefined };

export function checkLessonAnalysis(input: LessonAnalysis, ctx: AnalysisContext): { analysis: LessonAnalysis; report: AnalysisReport } {
  const a = structuredClone(input) as LessonAnalysis;
  const folded = ctx.texts.map((t) => fold(lessonText(t)));
  const report: AnalysisReport = { quotesDropped: 0, itemsDropped: 0, namesScrubbed: 0, studentTextIssues: [] };
  const inTime = (t: string | undefined | null): boolean => {
    const s = hmsSeconds(t ?? null);
    return s !== null && s <= ctx.maxSec + 5;
  };
  const evidence = (list: readonly Ev[] | undefined): Ev[] => {
    const kept = (list ?? []).filter((e) => quoteInTranscript(e.quote, folded) && inTime(e.t) && (!e.t_end || inTime(e.t_end)));
    report.quotesDropped += (list?.length ?? 0) - kept.length;
    return kept;
  };
  const leaf = (s: string | null | undefined): string | null => (s && ctx.leaves.has(s) ? s : null);
  const keep = <T>(list: T[], ok: (x: T) => boolean): T[] => {
    const out = list.filter(ok);
    report.itemsDropped += list.length - out.length;
    return out;
  };

  a.schema_version = '1.0';
  a.lesson_ref = ctx.lessonRef;
  a.student_ref = ctx.studentRef;
  if (ctx.durationMin !== null && ctx.durationMin >= 1) a.duration_min = ctx.durationMin;
  else delete a.duration_min;

  a.skills = keep(a.skills.map((s) => ({ ...s, evidence: evidence(s.evidence) })), (s) => leaf(s.skill_id) !== null && s.evidence.length > 0);
  a.misconceptions = keep(a.misconceptions.map((m) => ({ ...m, evidence: evidence(m.evidence) })), (m) => leaf(m.skill_id) !== null && m.evidence.length > 0);
  a.questions = keep(a.questions, (q) => {
    const ok = quoteInTranscript(q.quote, folded) && inTime(q.t);
    if (!ok) report.quotesDropped++;
    return ok;
  }).map((q) => (q.skill_id !== undefined ? { ...q, skill_id: leaf(q.skill_id) } : q));
  a.hesitations = keep(a.hesitations, (h) => {
    if (!inTime(h.t)) return false;
    if (h.quote === undefined) return true;
    const ok = quoteInTranscript(h.quote, folded);
    if (!ok) report.quotesDropped++;
    return ok;
  }).map((h) => (h.skill_id !== undefined ? { ...h, skill_id: leaf(h.skill_id) } : h));
  a.previous_profile_check = keep(
    a.previous_profile_check.map((p) => (p.evidence ? { ...p, evidence: evidence(p.evidence) } : p)),
    (p) => ctx.openMisconceptionIds.has(p.misconception_id),
  );
  a.commitments = keep(a.commitments, (c) => inTime(c.t));
  a.course_insights = keep(
    (a.course_insights ?? []).map((ci) => ({ ...ci, skill_id: leaf(ci.skill_id), evidence: evidence(ci.evidence) })),
    (ci) => ci.topic.trim().length > 0 && ci.text.trim().length > 0,
  );

  // son kemer: model metinlerinde ad tokenı (kareden okunmuş olabilir) → deterministik temizlik
  const clean = (s: string): string => {
    const r = scrubText(s, ctx.names);
    report.namesScrubbed += r.replaced;
    return r.text;
  };
  for (const m of a.misconceptions) {
    m.text_instructor = clean(m.text_instructor);
    m.text_student = clean(m.text_student);
  }
  for (const c of a.commitments) c.text = clean(c.text);
  if (a.talk.notes !== undefined) a.talk.notes = clean(a.talk.notes);
  a.next_step = { for_student: clean(a.next_step.for_student), for_instructor: clean(a.next_step.for_instructor) };
  for (const ci of a.course_insights) {
    ci.topic = clean(ci.topic);
    ci.text = clean(ci.text);
  }

  const student: [string, string][] = [
    ['next_step.for_student', a.next_step.for_student],
    ...a.misconceptions.map((m, i) => [`misconceptions[${i}].text_student`, m.text_student] as [string, string]),
    ...a.commitments.map((c, i) => [`commitments[${i}].text`, c.text] as [string, string]),
  ];
  for (const [path, text] of student) {
    const m = FORBIDDEN.exec(text);
    if (m) report.studentTextIssues.push(`${path}: öngörü ya da güvence sözü ("${m[2]}")`);
    if (text.includes('!')) report.studentTextIssues.push(`${path}: ünlem`);
    if (/%|\byüzde\b/iu.test(text)) report.studentTextIssues.push(`${path}: yüzde`);
  }
  return { analysis: a, report };
}

/** Onarım turunun kullanıcı metni: yalnız sorunlu alanlar düzeltilerek analizin tamamı yeniden yazılır. */
export function repairNote(issues: readonly string[]): string {
  return [
    'Önceki yanıtında öğrencinin göreceği metinlerde ürün kurallarına uymayan ifadeler vardı:',
    ...issues.map((i) => `- ${i}`),
    'Analizin tamamını aynı alıntı ve değerlerle yeniden yaz; yalnız bu alanları öngörü, güvence, ünlem ve yüzde içermeyecek biçimde düzelt.',
  ].join('\n');
}

/**
 * Onarım turundan sonra da kalan öğrenci metni sorunları: ders düşürülmez (iki Opus çağrısı harcanmış olur, yeniden
 * deneme anlamsız). Kendiliğinden onaylanabilecek tek öğrenci metni sözdür (taahhüt `promise`, güven 1,00): sorunlu söz
 * analizden çıkarılır. Sonraki adım, ödev/son tarih ve yanılgı metinleri her zaman boş güvenle eğitmen incelemesine
 * kalır (write_lesson_analysis); onlarda yalnız ünlem noktaya çevrilir, eğitmen metni onaylamadan öğrenciye gitmez.
 */
export function settleStudentTexts(input: LessonAnalysis, issues: readonly string[]): { analysis: LessonAnalysis; dropped: number; held: number } {
  const a = structuredClone(input) as LessonAnalysis;
  const flagged = new Set(issues.map((i) => i.split(':')[0]!));
  const calm = (t: string): string => t.replace(/!+/g, '.');
  let dropped = 0;
  let held = 0;
  a.commitments = a.commitments.filter((c, i) => {
    if (!flagged.has(`commitments[${i}].text`)) return true;
    if (c.kind === 'promise') {
      dropped++;
      return false;
    }
    held++;
    c.text = calm(c.text);
    return true;
  });
  if (flagged.has('next_step.for_student')) {
    held++;
    a.next_step = { ...a.next_step, for_student: calm(a.next_step.for_student) };
  }
  a.misconceptions.forEach((m, i) => {
    if (flagged.has(`misconceptions[${i}].text_student`)) {
      held++;
      m.text_student = calm(m.text_student);
    }
  });
  return { analysis: a, dropped, held };
}
