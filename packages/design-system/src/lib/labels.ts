// Ortak Türkçe etiketler (UI metni) ve kod değerleri.

/** observations.error_cause değerleri (PLAN-v2-detail §2.1). */
export type ErrorCause = 'concept' | 'procedure' | 'careless' | 'reading' | 'time';

export const ERROR_CAUSE_LABELS: Record<ErrorCause, string> = {
  concept: 'Kavram eksiği',
  procedure: 'İşlem hatası',
  careless: 'Dikkat hatası',
  reading: 'Soruyu okuma',
  time: 'Zaman baskısı',
};

/** conversations.mode değerleri: hint (varsayılan), explain, solve. */
export type TutorMode = 'hint' | 'explain' | 'solve';

export const TUTOR_MODES: ReadonlyArray<{ value: TutorMode; label: string; sub: string }> = [
  { value: 'hint', label: 'İpucu', sub: 'Adım adım yönlendirir' },
  { value: 'explain', label: 'Açıkla', sub: 'Konuyu anlatır' },
  { value: 'solve', label: 'Çözümü göster', sub: 'Tam çözümü verir' },
];

export const TUTOR_MODE_CONFIRMATIONS: Record<TutorMode, string> = {
  hint: 'Tamam, ipucuyla ilerleyeceğiz.',
  explain: 'Tamam, bu konuyu açıklayacağım.',
  solve: 'Tamam, bu soruda çözümü doğrudan göstereceğim.',
};
