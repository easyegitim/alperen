import 'server-only';
import type { UploadClient } from '@/server/uploads/client';
import { isUuid } from '@/server/uploads/shared';
import { bandWord, isLowEvidence, primarySkill, readAnalysis, summarySentence, type AnalysisJson, type ErrorCause, type Verdict } from './present';

export interface DiagnosisView {
  id: string;
  verdict: Verdict;
  failingStepNo: number | null;
  errorCause: ErrorCause | null;
  questionText: string | null;
  analysis: AnalysisJson;
  /** Tek cümle (Sonuç ekranı ve Bugün kartı ile aynı). */
  sentence: string;
  /** "Neyi öğrendik" tek satırı: yanılgının öğrenci metni ya da kazanım adı. */
  learned: string | null;
  /** Bozulmanın görüldüğü kazanım (yanılgının kazanımı, yoksa modelin ilki): ad + kelime bandı. */
  skill: { id: string; name: string; band: string; lowEvidence: boolean } | null;
  firstUploadId: string | null;
}

/**
 * Savunma katmanı: analiz bir deneme yanıtına bağlıysa ve sınav telifliyse (ya da bağ okunamazsa) soru metni
 * gösterilmez. Worker telifli denemede question_text'i zaten yazmaz; bu, eski satırlara karşı da korur.
 */
async function examQuestionHidden(client: UploadClient, analysisId: string): Promise<boolean> {
  // bu tablolar UploadClient tiplerinde yok; yalnız bu okuma için gevşek tip
  type Q = { select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null }> } } };
  const supabase = client as unknown as { from: (t: string) => Q };
  const { data: resp } = await supabase.from('exam_responses').select('session_id').eq('solution_analysis_id', analysisId).maybeSingle();
  if (!resp) return false;
  const { data: ses } = await supabase.from('exam_sessions').select('exam_id').eq('id', String(resp.session_id)).maybeSingle();
  if (!ses) return true;
  const { data: exam } = await supabase.from('exams').select('is_copyrighted').eq('id', String(ses.exam_id)).maybeSingle();
  return exam?.is_copyrighted !== false;
}

/**
 * Teşhis satırı + kazanım adı + ustalık bandı + yanılgı metni (kullanıcının JWT'si; RLS: öğrenci yalnız kendi kaydının
 * teşhisini görür, veli hiç görmez). Bulunamazsa null.
 */
export async function getDiagnosis(supabase: UploadClient, analysisId: string): Promise<DiagnosisView | null> {
  if (!isUuid(analysisId)) return null;
  const { data: sa } = await supabase
    .from('solution_analyses')
    .select('id, enrollment_id, upload_ids, question_text, analysis, verdict, failing_step_no, error_cause, skill_ids, misconception_tags')
    .eq('id', analysisId)
    .maybeSingle();
  if (!sa) return null;
  const analysis = readAnalysis(sa.analysis);
  const firstTag = sa.misconception_tags?.[0] ?? null;

  // önce yanılgı: "Bu kazanım" satırı "Neyi öğrendik"in kazanımıyla aynı olsun
  const [{ data: enr }, tag] = await Promise.all([
    supabase.from('enrollments').select('id, curriculum_id').eq('id', sa.enrollment_id).maybeSingle(),
    firstTag && sa.verdict !== 'correct'
      ? supabase.from('misconception_tags').select('tag, skill_id, text_student').eq('tag', firstTag).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const tagRow = tag.data as { skill_id?: string | null; text_student?: string } | null;
  const tagText = tagRow?.text_student ?? null;
  const firstSkill = primarySkill(sa.skill_ids ?? [], analysis.skill_order, tagRow?.skill_id ?? null);
  const [skill, mastery] = await Promise.all([
    firstSkill && enr
      ? supabase.from('skills').select('id, name').eq('curriculum_id', enr.curriculum_id).eq('id', firstSkill).maybeSingle()
      : Promise.resolve({ data: null }),
    firstSkill
      ? supabase.from('mastery').select('skill_id, p, evidence_count').eq('enrollment_id', sa.enrollment_id).eq('skill_id', firstSkill).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const skillName = (skill.data as { name?: string } | null)?.name ?? null;
  const m = mastery.data as { p?: number | string; evidence_count?: number } | null;
  const verdict = sa.verdict as Verdict;
  const failingStepNo = sa.failing_step_no ?? null;
  const errorCause = (sa.error_cause ?? null) as ErrorCause | null;
  return {
    id: sa.id,
    verdict,
    failingStepNo,
    errorCause,
    questionText: sa.question_text && !(await examQuestionHidden(supabase, sa.id)) ? sa.question_text : null,
    analysis,
    sentence: summarySentence({ verdict, failing_step_no: failingStepNo, error_cause: errorCause, analysis }),
    learned: verdict === 'unreadable' ? null : (tagText ?? skillName),
    skill:
      firstSkill && skillName
        ? {
            id: firstSkill,
            name: skillName,
            band: bandWord(m ? Number(m.p) : null, m?.evidence_count ?? null),
            lowEvidence: isLowEvidence(m ? Number(m.p) : null, m?.evidence_count ?? null),
          }
        : null,
    firstUploadId: sa.upload_ids?.[0] ?? null,
  };
}
