// exam_session_view örnek yanıtı (testler için; cevap anahtarı yok).
const R = (n: number) => `00000000-0000-4000-8000-0000000000a${n}`;

export function examViewFixture(): unknown {
  return {
    session_id: '00000000-0000-4000-8000-0000000000b1',
    exam_id: '00000000-0000-4000-8000-0000000000c1',
    title: 'Deneme 4',
    kind: 'deneme',
    source: 'uploaded',
    mode: 'uploaded',
    status: 'analysing',
    pending: false,
    progress: { stage: 'report' },
    is_copyrighted: true,
    answer_key_source: 'uploaded',
    report: null,
    summary: { total: 40, correct: 28, wrong: 8, blank: 4, unfinished: 0, ungraded: 0, net: 27.5, unverified_keys: 0, weakest: { skill_id: 'tyt.tr.paragraf', name: 'Türkçe paragraf' }, top_cause: 'procedure', one_line: 'x' },
    sections: [
      { section: 'tr', title: 'Türkçe', total: 20, correct: 18, wrong: 2, blank: 0, unfinished: 0, net: 18 },
      { section: 'mat', title: 'Matematik', total: 20, correct: 10, wrong: 6, blank: 4, unfinished: 0, net: 8.5 },
    ],
    heatmap: [
      { skill_id: 'tyt.mat.sayilar', name: 'Sayı kümeleri', total: 5, correct: 5, wrong: 0, blank: 0, band: 'high' },
      { skill_id: 'tyt.tr.paragraf', name: 'Türkçe paragraf', total: 6, correct: 2, wrong: 3, blank: 1, band: 'low' },
      { skill_id: 'tyt.mat.denklem', name: 'Birinci dereceden denklemler', total: 4, correct: 2, wrong: 1, blank: 1, band: 'mid' },
    ],
    items: [
      { response_id: R(1), no: 3, section: 'mat', outcome: 'wrong', state: 'needs_input', blank_reason: null, solution_analysis_id: null, diagnosis: null },
      { response_id: R(2), no: 7, section: 'tr', outcome: 'blank', state: 'pending', blank_reason: null, solution_analysis_id: null, diagnosis: null },
      { response_id: R(3), no: 9, section: 'tr', outcome: 'unfinished', state: 'reason_given', blank_reason: 'time', solution_analysis_id: null, diagnosis: null },
      { response_id: R(4), no: 12, section: 'mat', outcome: 'wrong', state: 'diagnosed', blank_reason: null, solution_analysis_id: R(5), diagnosis: { one_line: 'Çözümünü inceledim: 3. adımda işlem kuralı.' } },
    ],
    items_hidden: false,
  };
}
