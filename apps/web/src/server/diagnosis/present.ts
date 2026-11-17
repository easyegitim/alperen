// Teşhisin ekrana dönüşü (saf; test/diagnosis-present.test.ts). Sonuç (S05) ve Detay (S06) ekranları bunu çizer:
// tek cümle, bozulan adım, katlı adım merdiveni, tek satır kazanım (kelime bandı), "Koça sor" bağlantısı.
// Girdi solution_analyses satırıdır; `analysis` jsonb'sini apps/worker/src/jobs/diagnosis.ts yazar.

export type Verdict = 'correct' | 'wrong' | 'incomplete' | 'unreadable';
export type ErrorCause = 'concept' | 'procedure' | 'careless' | 'reading' | 'time';

export interface StudentStep {
  no: number;
  text: string;
  status: 'ok' | 'error' | 'missing';
}

/** analysis jsonb'sinin bu ekranın okuduğu alanları (eksik/bozuk alan güvenle boşa düşer). */
export interface AnalysisJson {
  why_tr: string | null;
  one_line: string | null;
  steps: StudentStep[];
  reference_steps: string[];
  /** Modelin kazanım sırası (worker yazar; solution_analyses.skill_ids alfabetik saklanır). Eski satırlarda boş. */
  skill_order: string[];
}

export function readAnalysis(raw: unknown): AnalysisJson {
  const a = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);
  const steps = Array.isArray(a.steps)
    ? (a.steps as unknown[]).flatMap((s) => {
        const o = s as Record<string, unknown> | null;
        if (!o || typeof o.no !== 'number' || typeof o.text !== 'string') return [];
        const status = o.status === 'error' || o.status === 'missing' ? o.status : 'ok';
        return [{ no: o.no, text: o.text, status } as StudentStep];
      })
    : [];
  const strings = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).filter((x): x is string => typeof x === 'string') : []);
  return {
    why_tr: str(a.why_tr),
    one_line: str(a.one_line),
    steps: steps.sort((x, y) => x.no - y.no),
    reference_steps: strings(a.reference_steps),
    skill_order: strings(a.skill_order),
  };
}

/**
 * "Bu kazanım" satırının kazanımı: "Neyi öğrendik"in yanılgısı bir kazanıma bağlıysa ve o kazanım teşhiste varsa o
 * (iki satır çelişmez); değilse modelin ilk kazanımı (analysis.skill_order), o da yoksa skill_ids'in ilki.
 */
export function primarySkill(skillIds: readonly string[], skillOrder: readonly string[], tagSkillId: string | null | undefined): string | null {
  if (tagSkillId && skillIds.includes(tagSkillId)) return tagSkillId;
  return skillOrder.find((s) => skillIds.includes(s)) ?? skillIds[0] ?? null;
}

const CAUSE_SHORT: Record<ErrorCause, string> = {
  concept: 'kavram karışmış',
  procedure: 'işlem kuralı',
  careless: 'küçük bir hesap kayması',
  reading: 'soruyu okuma',
  time: 'süre yetmemiş',
};

/** Sonuç ekranının tek cümlesi (worker'ın analysis.one_line'ı önceliklidir; yoksa aynı kuralla üretilir). */
export function summarySentence(v: { verdict: Verdict; failing_step_no: number | null; error_cause: ErrorCause | null; analysis: AnalysisJson }): string {
  if (v.analysis.one_line) return v.analysis.one_line;
  if (v.verdict === 'unreadable') return 'Fotoğraf okunamadı, yeniden çekebilirsin.';
  if (v.verdict === 'correct') return 'Çözümünü inceledim: yolun baştan sona doğru.';
  const cause = v.error_cause ? CAUSE_SHORT[v.error_cause] : 'bir hata';
  return v.failing_step_no !== null ? `Çözümünü inceledim: ${v.failing_step_no}. adımda ${cause}.` : `Çözümünü inceledim: ${cause}.`;
}

export type RowState = 'ok' | 'failing' | 'affected' | 'error' | 'missing';

export interface LadderRow {
  no: number;
  student: string;
  expected: string | null;
  state: RowState;
  /** Satır başlığının sağındaki kelime ("✓ Doğru", "✕ Burada bozuldu", "Bundan etkilendi"). */
  label: string;
}

const ROW_LABEL: Record<RowState, string> = {
  ok: '✓ Doğru',
  failing: '✕ Burada bozuldu',
  affected: 'Bundan etkilendi',
  error: '✕ Ayrıca hata',
  missing: 'Eksik adım',
};

/**
 * Adım merdiveni (S06): öğrencinin adımı ile beklenen adım aynı satırda. İlk bozulan adımdan önceki adımlar doğru;
 * sonrakiler, model ayrıca hata işaretlemediyse "bundan etkilendi" (taşınan yanlış sonuç). Beklenen adım sırayla eşlenir.
 */
export function ladderRows(steps: StudentStep[], reference: string[], failingStepNo: number | null): LadderRow[] {
  return steps.map((s, i) => {
    let state: RowState;
    if (failingStepNo === null || s.no < failingStepNo) state = s.status === 'ok' ? 'ok' : s.status;
    else if (s.no === failingStepNo) state = 'failing';
    else state = s.status === 'ok' ? 'affected' : s.status;
    return { no: s.no, student: s.text, expected: reference[i] ?? null, state, label: ROW_LABEL[state] };
  });
}

/** Kanıt bandı söyleyecek kadar değil (ustalık yok ya da kanıt `minEvidence`'ın altında). */
export function isLowEvidence(p: number | null | undefined, evidence: number | null | undefined, minEvidence = 5): boolean {
  return typeof p !== 'number' || !Number.isFinite(p) || typeof evidence !== 'number' || evidence < minEvidence;
}

/**
 * Ustalık bandı küçük harfle (yüzde yok): "zayıf" / "orta" / "iyi"; kanıt azsa "henüz az kanıt" (sayfa "şu an"
 * demez: "Bu kazanım: X · henüz az kanıt").
 */
export function bandWord(p: number | null | undefined, evidence: number | null | undefined, minEvidence = 5): string {
  if (typeof p !== 'number' || isLowEvidence(p, evidence, minEvidence)) return 'henüz az kanıt';
  if (p < 0.5) return 'zayıf';
  if (p < 0.8) return 'orta';
  return 'iyi';
}

/**
 * Koç sohbetine geçiş ("Koça sor"): Koç sayfası `?seed=<solution_analysis_id>` ile teşhis bağlamını (soru, çözüm,
 * bozulan adım, neden) ilk mesaja ekler (src/server/chat/bootstrap.ts). Kimlik yalnız RLS'in izin verdiği teşhisi açar.
 */
export function coachHref(analysisId: string): string {
  return `/ogrenci/koc?seed=${encodeURIComponent(analysisId)}`;
}
