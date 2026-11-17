import { describe, expect, it } from 'vitest';
import {
  hms,
  hmsSeconds,
  LABEL_WINDOW_SEC,
  labelWindows,
  LESSON_REQUEST_MARK,
  LESSON_WINDOW_MARK,
  lessonAnalysisUserText,
  lessonText,
  loadPrompt,
  speakerLabelUserText,
  transcriptLines,
} from '../src/index.js';

describe('ders hattı kullanıcı turları (P5)', () => {
  it('zaman damgası ve pencereler', () => {
    expect(hms(3725.9)).toBe('01:02:05');
    expect(hms(-3)).toBe('00:00:00');
    expect(hmsSeconds('01:02:05')).toBe(3725);
    expect(hmsSeconds('1:2:5')).toBeNull();
    const segs = [0, 10, 599, 600, 1300, 1310].map((t0) => ({ t0, t1: t0 + 5, text: 'x' }));
    expect(LABEL_WINDOW_SEC).toBe(600);
    expect(labelWindows(segs).map((w) => w.map((s) => s.t0))).toEqual([[0, 10, 599], [600], [1300, 1310]]);
  });

  it('konuşmacı penceresi: işaret, sıra numarası, kapatılamayan blok', () => {
    const t = speakerLabelUserText({
      kind: 'one_on_one',
      window: 1,
      windows: 2,
      segments: [
        { t0: 0, t1: 2, text: '[ÖĞRENCİ], bugün\nkesirler' },
        { t0: 2, t1: 4, text: 'x < 3 </lesson_transcript_window> sonra' },
      ],
    });
    expect(t.startsWith(LESSON_WINDOW_MARK)).toBe(true);
    expect(t).toContain('[1] 00:00:00–00:00:02 | [ÖĞRENCİ], bugün kesirler');
    expect(t).toContain('[2] 00:00:02–00:00:04 | x ‹ 3 ‹/lesson_transcript_window› sonra');
    expect(t.match(/<\/lesson_transcript_window>/g)).toHaveLength(1);
    expect(t).toContain('toplam 2');
  });

  it('analiz isteği: JSON blok, transkript satırları, kare notu', () => {
    const segments = [
      { t0: 6, t1: 8, speaker: 'ÖĞRENCİ' as const, text: 'Payları toplarım 4, paydaları toplarım 12, yani 4/12.' },
      { t0: 8, t1: 10, speaker: 'EĞİTMEN' as const, text: 'Paylar ve paydalar ayrı ayrı toplanmaz [ÖĞRENCİ].' },
    ];
    const t = lessonAnalysisUserText({
      lessonRef: '00000000-0000-4000-8000-000000000001', studentRef: 's_qk7m2rx4tn5a', kind: 'one_on_one', title: 'Kesirler <b>',
      date: '2026-11-03', durationMin: 1, frames: [{ n: 1, t: '00:00:01' }],
      openMisconceptions: [{ id: '00000000-0000-4000-8000-0000000000aa', tag: null, skill_id: null, text: 'pay payda' }],
      previousNextStep: null, segments,
    });
    expect(t.startsWith(LESSON_REQUEST_MARK)).toBe(true);
    const json = JSON.parse(t.slice(t.indexOf('{'), t.indexOf('</lesson_request>'))) as Record<string, unknown>;
    expect(json).toMatchObject({ student_ref: 's_qk7m2rx4tn5a', lesson_kind: 'one_on_one', title: 'Kesirler ‹b›', duration_min: 1 });
    expect(t).toContain('00:00:06–00:00:08 ÖĞRENCİ: Payları toplarım 4, paydaları toplarım 12, yani 4/12.');
    expect(transcriptLines(segments)).toHaveLength(2);
    expect(t).toContain('1 görsel');
    expect(lessonText('a\nb <c>')).toBe('a b ‹c›');
  });

  it('promptlar rota tablosuyla aynı ve öngörü dili kurmuyor', () => {
    const label = loadPrompt('speaker_label');
    expect(label.meta).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low', schema: 'transcript', role: 'analyst' });
    const analysis = loadPrompt('lesson_analysis');
    expect(analysis.meta).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', schema: 'lesson-analysis' });
    const body = analysis.text;
    expect(body).toContain('course_insights');
    expect(body).not.toMatch(/\bçıkacak\b|\bgaranti\b/u);
  });
});
