/**
 * Öneri motoru kuralları (docs/PLAN-v2.md §13 "Öneri motoru"): saf ve deterministik. Girdi `StudentSignals`
 * (signals.ts veritabanından toplar), çıktı sıralı kart listesi (replace_suggestions p_items). Kart metni burada şablondur;
 * copy.ts Haiku (suggestions_copy) ile yeniden yazabilir, sayılar değişmez.
 *
 *   sıra  tür              kural
 *   1     weekly_homework  son 7 günde eğitmen ödevi (instructor_notes 'Ödev:' / kind='homework', onaylı ders iddiası homework)
 *   2     practice         en zayıf 2 kanıtlı yaprak (bugün çalışılanlar geri planda); kanıt yoksa ağaçtaki ilk 2 yaprak
 *   3     gap_analysis     açık yanılgının yaprağı (+ "asıl sorun" ön koşulu) ya da aralıklı tekrar vadesi gelen yapraklar
 *   4     lesson_review    son 7 günde onaylı ders analizi (iddia kazanımları) → 5 soru + 1 sayfa özet
 *   5     mini_exam        sınav tarihine 0–14 gün
 *   6     document_ready   son 7 günde 'rendered' / 'published' kişisel belge
 *   7     upload_result    son 48 saatte biten yükleme analizi (teşhis: analysis.one_line; değerlendirilen deneme), bekleyen
 *                          okul denemesi ('analysing' oturum) ya da işlenemeyen yükleme ('diagnosis.failed'); uploadNotice
 * Kahraman kart (rank 0): ödev varsa ödev, yoksa alıştırma. Başlatılmış (consumed) bir kaynağa (not, ders analizi,
 * belge, yükleme) yeniden kart açılmaz. Hepsi ertesi gün 05:00'te (Europe/Istanbul) düşer: gece yenilemesi (03:30)
 * yeni kartları yazana dek gece yarısından sonra da Bugün boş kalmaz; ayrıca her etkinlikten sonra yeniden hesaplanır.
 * İki bant ayrı sınırlanır: en çok MAX_STARTABLE başlatılabilir kart (ilk 4'ü Bugün'de: settings.suggestions_today_max)
 * ve en çok MAX_NOTICES bildirim kartı (belge hazır, yükleme sonucu; settings.suggestions_notices_max). Bildirimler
 * başlatılabilir kartların arkasında kalıp görünmez olmaz (list_today_suggestions iki bandı ayrı sınırlar).
 */

export type SuggestionKind =
  | 'practice'
  | 'weekly_homework'
  | 'lesson_review'
  | 'gap_analysis'
  | 'mini_exam'
  | 'document_ready'
  | 'upload_result';

export interface LeafMastery {
  skillId: string;
  name: string;
  p: number;
  n: number;
  /** Son ustalık değişimi (mastery_history.created_at ya da mastery.last_evidence_at), ISO. */
  lastAt: string | null;
}

export interface EnrollmentSignals {
  enrollmentId: string;
  courseId: string | null;
  courseTitle: string | null;
  /** YYYY-MM-DD. */
  examDate: string | null;
  targetExam: string | null;
  /** Kanıtlı yapraklar (p artan). */
  leaves: LeafMastery[];
  /** Kanıt yoksa başlangıç yaprakları (ağaç sırası). */
  firstLeaves: { skillId: string; name: string }[];
  /** En güçlü kanıtlı açık yanılgı. */
  topMisconception: { tag: string | null; skillId: string; skillName: string; prereqSkillId: string | null; prereqName: string | null } | null;
  homework: { refId: string; source: 'note' | 'lesson_claim'; skillIds: string[]; skillNames: string[]; createdAt: string }[];
  lessonReview: { analysisId: string; lessonId: string; heldAt: string; skillIds: string[]; skillNames: string[] } | null;
}

/**
 * Yükleme bildirimi (Bugün'de 'upload_result' kartı). Tek kaynak: worker (diagnosis.run, upload.intake) kartı hemen bu
 * sinyalle `uploadNotice` üzerinden yazar, suggestions.refresh aynı sinyali veritabanından yeniden kurar; ikisi aynı
 * `copy_key`, başlık ve alt satırı üretir (replace_suggestions kartı yerinde günceller, silmez).
 *   result  — teşhis (analysis:<id>; alt satır analysis.one_line) ya da değerlendirilmiş okul denemesi (session:<id>)
 *   pending — okul denemesi alındı, analiz bekliyor (upload:<ilk yükleme>; oturum 'analysing')
 *   failed  — işlenemedi (upload:<ilk yükleme>; audit.events 'diagnosis.failed', neden reading | processing)
 */
export interface UploadSignal {
  ref: string;
  analysisId: string | null;
  sessionId: string | null;
  uploadId: string | null;
  enrollmentId: string;
  verdict: string | null;
  at: string;
  net: number | null;
  state?: 'result' | 'pending' | 'failed';
  uploadIds?: string[];
  /** Teşhisin tek cümlesi (solution_analyses.analysis.one_line). */
  oneLine?: string | null;
  failure?: 'reading' | 'processing' | null;
  reason?: string | null;
  examId?: string | null;
}

export interface StudentSignals {
  studentId: string;
  /** Europe/Istanbul günü (YYYY-MM-DD). */
  today: string;
  enrollments: EnrollmentSignals[];
  documents: { documentId: string; kind: string; title: string; enrollmentId: string | null; updatedAt: string }[];
  uploads: UploadSignal[];
  /** Başlatılmış önerilerin kaynak anahtarları (her zaman) — `refKey` biçiminde. */
  consumedRefs: string[];
  /** Bugün başlatılan alıştırma kartlarının kazanımları (yeniden önerilmez, alternatif yoksa önerilir). */
  practicedToday: string[];
}

export interface PlannedSuggestion {
  kind: SuggestionKind;
  enrollment_id: string | null;
  rank: number;
  expires_at: string;
  payload: Record<string, unknown>;
  /** Şablon metin (copy.ts yedeği ve LLM girdisi). */
  title: string;
  subtitle: string;
  /** Aynı öneriyi tanıyan anahtar (kopya yeniden kullanımı, tekilleştirme). */
  key: string;
  /** suggestions_copy girdisi (kart türü + içerik). */
  copyInput: Record<string, unknown>;
}

/** Bildirim kartları (Başla değil Aç; Bugün'de ayrı satır, mockup S02). */
export const NOTICE_KINDS: readonly SuggestionKind[] = ['document_ready', 'upload_result'];
export const MAX_STARTABLE = 8;
export const MAX_NOTICES = 2;
/** replace_suggestions sınırı (≤ 10). */
export const MAX_SUGGESTIONS = MAX_STARTABLE + MAX_NOTICES;
export const PRACTICE = { count: 8, minutes: 12 } as const;
/** PLAN-v2 §13 (1): eksik analizi/alıştırma 8–10 soru. */
export const GAP = { count: 8, minutes: 12 } as const;
export const HOMEWORK = { count: 10, minutes: 20 } as const;
export const LESSON_REVIEW = { count: 5, minutes: 15 } as const;
export const MINI_EXAM = { count: 20, minutes: 30, withinDays: 14 } as const;
/** Ustalık bu eşiğin üstündeyse yaprak "zayıf" sayılmaz; aralıklı tekrar adayı olur. */
export const WEAK_BELOW = 0.85;
export const REVIEW_FROM = 0.6;

/** Aralıklı tekrar aralığı (gün): ustalık arttıkça uzar. */
export function reviewIntervalDays(p: number): number {
  if (p < 0.75) return 2;
  if (p < 0.9) return 5;
  return 12;
}

const RANK: Record<SuggestionKind, number> = {
  weekly_homework: 0,
  practice: 10,
  gap_analysis: 20,
  lesson_review: 30,
  mini_exam: 40,
  upload_result: 50,
  document_ready: 60,
};
/** Worker'ın hemen yazdığı yükleme kartının sırası (öneri motorunun ilk bildirim sırasıyla aynı). */
export const RANK_UPLOAD_RESULT = RANK.upload_result;

export function refKey(kind: 'note' | 'lesson_claim' | 'lesson_analysis' | 'document' | 'analysis' | 'session' | 'upload', id: string): string {
  return `${kind}:${id}`;
}

/** Yükleme kartlarının sabit metni (worker ve öneri motoru aynı metni yazar; ünlem/emoji/yüzde yok). */
export const UPLOAD_CARD = {
  result: 'Yüklemenin sonucu hazır',
  unreadable: 'Fotoğrafı okuyamadım',
  failed: {
    reading: { title: 'Fotoğrafı okuyamadım', subtitle: 'Daha net bir fotoğrafla yeniden yükleyebilirsin.' },
    processing: { title: 'Yüklemeni şu an işleyemedim', subtitle: 'Yeniden dener misin? Sayfaları tekrar gönderebilirsin.' },
  },
  pending: { title: 'Denemeni inceliyorum', subtitle: 'Sayfaları aldım; sonuç birkaç dakika içinde burada olacak.' },
  /** Değerlendirilen okul denemesi (alt satır: "Örnek Deneme 1: 5,5 net. Takıldığın yer: Üslü ifadeler."). */
  exam: 'Deneme sonucun hazır',
} as const;

const VERDICT_LINE: Record<string, string> = {
  correct: 'Çözümün doğru',
  wrong: 'Takıldığın adımı buldum',
  incomplete: 'Çözümün yarım kalmış, devamını gösterdim',
  unreadable: 'Fotoğraf okunamadı, yeniden çekebilirsin',
};

/** Yükleme sinyali → kartın anahtarı, metni ve yükü (worker kartı ve suggestions.refresh aynı sonucu verir). */
export function uploadNotice(u: UploadSignal): { key: string; title: string; subtitle: string; payload: Record<string, unknown> } {
  const ids = u.uploadIds?.length ? u.uploadIds : u.uploadId ? [u.uploadId] : [];
  const state = u.state ?? 'result';
  if (state === 'failed') {
    const kind = u.failure === 'reading' ? 'reading' : 'processing';
    return {
      key: u.ref,
      ...UPLOAD_CARD.failed[kind],
      payload: { upload_id: u.uploadId, upload_ids: ids, analysis_id: null, session_id: u.sessionId ?? null, failed: true, failure: kind, reason: u.reason ?? null },
    };
  }
  if (state === 'pending') {
    return {
      key: u.ref,
      ...UPLOAD_CARD.pending,
      payload: { upload_id: u.uploadId, upload_ids: ids, exam_id: u.examId ?? null, session_id: u.sessionId, pending: true },
    };
  }
  if (u.sessionId) {
    return {
      key: u.ref,
      title: UPLOAD_CARD.exam,
      subtitle: u.oneLine?.trim()
        ? clip(u.oneLine.trim(), 160)
        : `Okul denemen değerlendirildi${u.net !== null ? ` · ${String(u.net).replace('.', ',')} net` : ''}`,
      payload: { upload_id: u.uploadId, upload_ids: ids, analysis_id: null, session_id: u.sessionId, exam_id: u.examId ?? null, net: u.net },
    };
  }
  const line = u.oneLine?.trim() ? clip(u.oneLine.trim(), 160) : (VERDICT_LINE[u.verdict ?? ''] ?? 'Sonuç hazır');
  return {
    key: u.ref,
    title: u.verdict === 'unreadable' ? UPLOAD_CARD.unreadable : UPLOAD_CARD.result,
    subtitle: line,
    payload: { upload_id: u.uploadId, upload_ids: ids, analysis_id: u.analysisId, session_id: null, verdict: u.verdict },
  };
}

/** Europe/Istanbul günü (YYYY-MM-DD). */
export function istanbulDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Günün sonu: ertesi gün 00:00 Europe/Istanbul (UTC+3, yaz saati yok) → ISO (UTC). */
export function endOfIstanbulDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0) - 3 * 3600 * 1000).toISOString();
}

/** Kart ömrü gün sonundan bu kadar sonra biter: gece yenilemesinden (03:30) sonra, 05:00 Europe/Istanbul. */
export const CARD_GRACE_HOURS = 5;

/** Kartın düşme anı: ertesi gün 05:00 Europe/Istanbul → ISO (UTC). */
export function cardExpiry(day: string): string {
  return new Date(Date.parse(endOfIstanbulDay(day)) + CARD_GRACE_HOURS * 3600 * 1000).toISOString();
}

function daysBetween(fromDay: string, toDay: string): number {
  const a = Date.parse(`${fromDay}T00:00:00Z`);
  const b = Date.parse(`${toDay}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

const WEEKDAY_TR = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];

function weekday(iso: string): string {
  const day = istanbulDay(new Date(iso));
  return WEEKDAY_TR[new Date(`${day}T12:00:00Z`).getUTCDay()] ?? '';
}

/** "A, B" (en çok iki ad; adların kendisi "ve" içerebildiği için virgülle). */
function names(list: readonly string[]): string {
  return [...new Set(list.filter(Boolean))].slice(0, 2).join(', ');
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Kısa kazanım adı: "Rasyonel sayılarda dört işlem ve sıralama" → ilk virgüle/parantezine kadar, ≤ 48 karakter. */
export function shortName(name: string): string {
  const cut = name.split(/[,(:;]/)[0]!.trim();
  return clip(cut || name, 48);
}

const sortedKey = (ids: readonly string[]) => [...ids].sort().join('+');

/** Tek öğrencinin önerileri (rank artan; en çok MAX_STARTABLE başlatılabilir + MAX_NOTICES bildirim). */
export function planSuggestions(sig: StudentSignals): PlannedSuggestion[] {
  const out: PlannedSuggestion[] = [];
  const expires = cardExpiry(sig.today);
  const consumed = new Set(sig.consumedRefs);
  const practiced = new Set(sig.practicedToday);
  const used = new Set<string>(); // aynı karta iki kez giren yaprak olmasın
  const push = (s: Omit<PlannedSuggestion, 'expires_at'>) => out.push({ ...s, expires_at: expires });

  sig.enrollments.forEach((e, ei) => {
    const primary = ei === 0;
    const course = e.courseTitle ?? '';

    // (1) eğitmen ödevi
    for (const h of e.homework) {
      const ref = refKey(h.source, h.refId);
      if (consumed.has(ref)) continue;
      const topic = names(h.skillNames.map(shortName));
      push({
        kind: 'weekly_homework',
        enrollment_id: e.enrollmentId,
        rank: RANK.weekly_homework + ei,
        payload: { skill_ids: h.skillIds, count: HOMEWORK.count, minutes: HOMEWORK.minutes, source: h.source, ref_id: h.refId },
        title: 'Haftalık ödev',
        subtitle: `${topic ? `${clip(topic, 60)} · ` : ''}${HOMEWORK.count} soru · ${HOMEWORK.minutes} dk`,
        key: ref,
        copyInput: { kind: 'weekly_homework', topic: topic || null, course, count: HOMEWORK.count, minutes: HOMEWORK.minutes },
      });
      h.skillIds.forEach((s) => used.add(s));
      break; // kayıt başına tek ödev kartı (en yenisi)
    }

    // (2) en zayıf 2 yaprak → alıştırma
    const weakAll = e.leaves.filter((l) => l.p < WEAK_BELOW && !used.has(l.skillId));
    const fresh = weakAll.filter((l) => !practiced.has(l.skillId));
    const weak = (fresh.length > 0 ? fresh : weakAll).slice(0, 2);
    const starter = e.leaves.length === 0 ? e.firstLeaves.filter((l) => !used.has(l.skillId)).slice(0, 2) : [];
    const target = weak.length ? weak.map((l) => ({ skillId: l.skillId, name: l.name })) : starter;
    if (target.length && (primary || weak.length)) {
      const topic = names(target.map((t) => shortName(t.name)));
      const ids = target.map((t) => t.skillId);
      push({
        kind: 'practice',
        enrollment_id: e.enrollmentId,
        rank: RANK.practice + ei,
        payload: { skill_ids: ids, count: PRACTICE.count, minutes: PRACTICE.minutes, reason: weak.length ? 'weakest' : 'starter' },
        // Kahraman kart başlığı tek konu (mockup S02: "Rasyonel sayılar"); ikinci yaprak payload'da
        title: shortName(target[0]!.name),
        subtitle: `${PRACTICE.count} soru · ${PRACTICE.minutes} dk`,
        key: `practice:${e.enrollmentId}:${sortedKey(ids)}`,
        copyInput: { kind: 'practice', topic, course, count: PRACTICE.count, minutes: PRACTICE.minutes, first_test: !weak.length },
      });
      ids.forEach((s) => used.add(s));
    }

    // (3) eksik analizi: açık yanılgı (asıl sorun ön koşulda olabilir) ya da aralıklı tekrar vadesi
    const mc = e.topMisconception;
    if (mc && !used.has(mc.skillId)) {
      const ids = [mc.skillId, ...(mc.prereqSkillId && mc.prereqSkillId !== mc.skillId ? [mc.prereqSkillId] : [])];
      const topic = names([shortName(mc.skillName), ...(mc.prereqName ? [shortName(mc.prereqName)] : [])]);
      push({
        kind: 'gap_analysis',
        enrollment_id: e.enrollmentId,
        rank: RANK.gap_analysis + ei,
        payload: { skill_ids: ids, count: GAP.count, minutes: GAP.minutes, reason: 'misconception', misconception_tag: mc.tag },
        title: 'Eksik analizi',
        subtitle: `${clip(shortName(mc.skillName), 60)} · ${GAP.count} soru · ${GAP.minutes} dk`,
        key: `gap:${e.enrollmentId}:${sortedKey(ids)}`,
        copyInput: { kind: 'gap_analysis', topic, course, count: GAP.count, minutes: GAP.minutes, reason: 'misconception' },
      });
      ids.forEach((s) => used.add(s));
    } else {
      // Ders tekrarı kartının kazanımları burada yinelenmez
      const lessonSkills = new Set(e.lessonReview?.skillIds ?? []);
      const due = e.leaves
        .filter((l) => l.p >= REVIEW_FROM && l.lastAt && !used.has(l.skillId) && !practiced.has(l.skillId) && !lessonSkills.has(l.skillId))
        .map((l) => ({ l, overdue: daysBetween(istanbulDay(new Date(l.lastAt!)), sig.today) / reviewIntervalDays(l.p) }))
        .filter((x) => x.overdue >= 1)
        .sort((a, b) => b.overdue - a.overdue || a.l.p - b.l.p || (a.l.skillId < b.l.skillId ? -1 : 1))
        .slice(0, 2)
        .map((x) => x.l);
      if (due.length) {
        const ids = due.map((l) => l.skillId);
        const topic = names(due.map((l) => shortName(l.name)));
        push({
          kind: 'gap_analysis',
          enrollment_id: e.enrollmentId,
          rank: RANK.gap_analysis + ei,
          payload: { skill_ids: ids, count: GAP.count, minutes: GAP.minutes, reason: 'spaced_review' },
          title: 'Tekrar zamanı',
          subtitle: `${clip(topic, 60)} · ${GAP.count} soru · ${GAP.minutes} dk`,
          key: `gap:${e.enrollmentId}:${sortedKey(ids)}`,
          copyInput: { kind: 'gap_analysis', topic, course, count: GAP.count, minutes: GAP.minutes, reason: 'spaced_review' },
        });
        ids.forEach((s) => used.add(s));
      }
    }

    // (4) ders tekrarı
    const lr = e.lessonReview;
    if (lr && lr.skillIds.length && !consumed.has(refKey('lesson_analysis', lr.analysisId))) {
      const topic = names(lr.skillNames.map(shortName));
      const day = weekday(lr.heldAt);
      push({
        kind: 'lesson_review',
        enrollment_id: e.enrollmentId,
        rank: RANK.lesson_review + ei,
        payload: { skill_ids: lr.skillIds, count: LESSON_REVIEW.count, minutes: LESSON_REVIEW.minutes, lesson_id: lr.lessonId, analysis_id: lr.analysisId, summary_pages: 1 },
        title: topic ? clip(`Ders tekrarı: ${topic}`, 120) : 'Ders tekrarı',
        subtitle: `${day ? `${day} dersinden ` : ''}${LESSON_REVIEW.count} soru ve kısa özet · ${LESSON_REVIEW.minutes} dk`,
        key: refKey('lesson_analysis', lr.analysisId),
        copyInput: { kind: 'lesson_review', topic: topic || null, lesson_day: day || null, count: LESSON_REVIEW.count, minutes: LESSON_REVIEW.minutes, summary_pages: 1 },
      });
    }

    // (5) mini deneme
    if (e.examDate) {
      const left = daysBetween(sig.today, e.examDate);
      const key = `mini_exam:${e.enrollmentId}:${sig.today}`;
      if (left >= 0 && left <= MINI_EXAM.withinDays && !consumed.has(key)) {
        push({
          kind: 'mini_exam',
          enrollment_id: e.enrollmentId,
          rank: RANK.mini_exam + ei,
          payload: { exam_id: null, count: MINI_EXAM.count, minutes: MINI_EXAM.minutes, days_left: left, target_exam: e.targetExam },
          title: 'Mini deneme',
          subtitle: `${left === 0 ? 'Sınav bugün' : `Sınava ${left} gün kaldı`} · ${MINI_EXAM.count} soru · ${MINI_EXAM.minutes} dk`,
          key,
          copyInput: { kind: 'mini_exam', exam: e.targetExam, days_left: left, count: MINI_EXAM.count, minutes: MINI_EXAM.minutes },
        });
      }
    }
  });

  // Bildirimlerde aynı türün sonrakiler bant içinde geri düşer (belge ve yükleme sırayla): sınır 2 iken biri diğerini
  // gölgelemez (mockup S02: yükleme satırı ve "notun hazır" birlikte)
  const noticeSeq: Partial<Record<SuggestionKind, number>> = {};
  const noticeRank = (k: 'document_ready' | 'upload_result') => {
    const i = noticeSeq[k] ?? 0;
    noticeSeq[k] = i + 1;
    return RANK[k] + i * 20;
  };

  // (6) hazır belge
  const DOC_TITLE: Record<string, (t: string) => string> = {
    notes: (t) => `${t} notun hazır`,
    mock_exam: () => 'Denemen hazır',
    question_set: (t) => `${t} soruların hazır`,
    report: () => 'Raporun hazır',
  };
  for (const d of sig.documents) {
    const ref = refKey('document', d.documentId);
    if (consumed.has(ref)) continue;
    const title = clip((DOC_TITLE[d.kind] ?? ((t: string) => `${t} hazır`))(clip(d.title, 60)), 120);
    push({
      kind: 'document_ready',
      enrollment_id: d.enrollmentId,
      rank: noticeRank('document_ready'),
      payload: { document_id: d.documentId, kind: d.kind },
      title,
      subtitle: 'PDF · aç ve indir',
      key: ref,
      copyInput: { kind: 'document_ready', document_kind: d.kind, topic: d.title },
    });
  }

  // (7) yükleme sonucu / bekleyen deneme / işlenemeyen yükleme (worker'ın hemen yazdığı kartla aynı anahtar ve metin)
  for (const u of sig.uploads) {
    if (consumed.has(u.ref)) continue;
    const n = uploadNotice(u);
    push({
      kind: 'upload_result',
      enrollment_id: u.enrollmentId,
      rank: noticeRank('upload_result'),
      payload: n.payload,
      title: n.title,
      subtitle: n.subtitle,
      key: n.key,
      copyInput: { kind: 'upload_result', summary: n.subtitle },
    });
  }

  const sorted = out.sort((a, b) => a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const startable = sorted.filter((s) => !NOTICE_KINDS.includes(s.kind)).slice(0, MAX_STARTABLE);
  const notices = sorted.filter((s) => NOTICE_KINDS.includes(s.kind)).slice(0, MAX_NOTICES);
  return [...startable, ...notices]
    .sort((a, b) => a.rank - b.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((s, i) => ({ ...s, rank: i === 0 ? 0 : s.rank === 0 ? 1 : s.rank }));
}

/** Başlatılmış öneri satırları → kaynak anahtarları (planSuggestions bunlara yeniden kart açmaz). */
export function consumedRefsOf(
  rows: readonly { kind: string; enrollment_id: string | null; payload: Record<string, unknown> | null; consumed_at: string | Date }[],
): { refs: string[]; practicedToday: (today: string) => string[] } {
  const refs = new Set<string>();
  const practiced: { day: string; ids: string[] }[] = [];
  for (const r of rows) {
    const p = r.payload ?? {};
    const str = (k: string) => (typeof p[k] === 'string' && p[k] !== '' ? (p[k] as string) : null);
    const day = istanbulDay(r.consumed_at instanceof Date ? r.consumed_at : new Date(r.consumed_at));
    switch (r.kind) {
      case 'weekly_homework': {
        const src = str('source');
        const id = str('ref_id');
        if (id && (src === 'note' || src === 'lesson_claim')) refs.add(refKey(src, id));
        break;
      }
      case 'lesson_review':
        if (str('analysis_id')) refs.add(refKey('lesson_analysis', str('analysis_id')!));
        break;
      case 'document_ready':
        if (str('document_id')) refs.add(refKey('document', str('document_id')!));
        break;
      case 'upload_result':
        // bekleyen ya da düşen yüklemenin kartı upload:<ilk yükleme> anahtarlıdır; açılması sonraki sonucu gizlemez
        if (p.pending === true || p.failed === true) {
          if (str('upload_id')) refs.add(refKey('upload', str('upload_id')!));
          break;
        }
        if (str('analysis_id')) refs.add(refKey('analysis', str('analysis_id')!));
        if (str('session_id')) refs.add(refKey('session', str('session_id')!));
        break;
      case 'mini_exam':
        if (r.enrollment_id) refs.add(`mini_exam:${r.enrollment_id}:${day}`);
        break;
      default:
        break;
    }
    if (r.kind === 'practice' || r.kind === 'gap_analysis' || r.kind === 'weekly_homework' || r.kind === 'lesson_review') {
      const ids = Array.isArray(p.skill_ids) ? p.skill_ids.map(String) : [];
      practiced.push({ day, ids });
    }
  }
  return { refs: [...refs].sort(), practicedToday: (today) => [...new Set(practiced.filter((x) => x.day === today).flatMap((x) => x.ids))].sort() };
}
