// Ödeme öncesi kalite kararları (KB §3.1/6, R1-E12/E14; PLAN 1d): "uygun fotoğraf reddedilmez, ret yerine uyarı".
// Yalnız yüz yok / birden çok yüz engeller; diğer sorunlar evet/hayır pop-up'ı (camera.qualityPrompt). Saf; birim testli.
import { GALLERY_QUALITY_CONFIG, MANUAL_QUALITY_CONFIG, checkQuality, lenientReview, sideViewReview, type HardIssue, type QualityIssue, type QualityReport } from "@/lib/face/quality";
import type { FrameAnalysis } from "@/lib/face/types";
import type { ViewKey } from "@/lib/face/views";
import { isProfileView } from "./views";

export type FrontDecision = {
  ok: boolean;
  /** Engel: yalnız yüz yok / çok yüz. */
  hard: HardIssue | null;
  /** Uyarı listesi; boş değilse pop-up çıkar, sonuç yalnız "Evet" ile sürer. */
  warnings: QualityIssue[];
  prompt: boolean;
  /** Uyarıyla ya da elle çekimle devam: yalnız saklanan üst veri; skoru değiştirmez (C7). */
  relaxed: boolean;
  report: QualityReport;
};

/** Ön fotoğraf: galeri/stüdyo eşikleri (gevşek); elle "Şimdi çek" gevşek elle eşiği geçerse uyarı yok. */
export function decideFront(frame: FrameAnalysis, opts: { manual?: boolean } = {}): FrontDecision {
  const strict = checkQuality(frame);
  const lr = lenientReview(frame, GALLERY_QUALITY_CONFIG);
  const manualOk = opts.manual ? checkQuality(frame, MANUAL_QUALITY_CONFIG).passed : false;
  const warnings = lr.hard ? [] : manualOk ? [] : lr.warnings;
  return {
    ok: lr.hard === null,
    hard: lr.hard,
    warnings,
    prompt: lr.hard === null && warnings.length > 0,
    relaxed: lr.hard === null && (warnings.length > 0 || (opts.manual === true && !strict.passed)),
    report: lr.report,
  };
}

/** Yan açılar: profilde yüz ağı güvenilmediği için "yüz yok" engel değil; birden çok yüz her açıda engel. */
export function decideSide(frame: FrameAnalysis, view: ViewKey): { ok: boolean; hard: HardIssue | null } {
  const r = sideViewReview(frame, { allowNoFace: isProfileView(view) });
  return { ok: r.hard === null, hard: r.hard };
}

/** Canlı önizlemede yan açı için tek satır: yalnız "birden çok yüz" uyarısı. */
export function sideLiveIssue(frame: Pick<FrameAnalysis, "faces">): "multiple_faces" | null {
  return frame.faces > 1 ? "multiple_faces" : null;
}
