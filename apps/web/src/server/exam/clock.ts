// Sınav zamanlayıcısı (saf). Süre sunucudan türetilir: sayfa yüklenirken sunucu saati (server_now) ile istemci saati
// arasındaki fark ölçülür (oynatıcı mount sonrası bir gidiş-dönüşle, istek/yanıt ortası; sayfa indirme gecikmesi karışmaz); kalan süre = bitiş sınırı - (istemci şimdi + fark). Sayaç yalnız gösterir; süreyi
// asıl veren ve cevabı reddeden veritabanıdır (exam_deadline + exam_time_grace_sec).

export interface ExamClock {
  /** Bitiş sınırı (epoch ms); süresiz sınavda null. */
  deadlineMs: number | null;
  /** sunucu saati - istemci saati (ms), yükleme anında ölçülür. */
  skewMs: number;
}

export function makeClock(input: { deadlineAt: string | null | undefined; serverNow: string; clientNow: number }): ExamClock {
  const deadline = input.deadlineAt ? Date.parse(input.deadlineAt) : NaN;
  const server = Date.parse(input.serverNow);
  return {
    deadlineMs: Number.isFinite(deadline) ? deadline : null,
    skewMs: Number.isFinite(server) ? server - input.clientNow : 0,
  };
}

/** Kalan tam saniye (yukarı yuvarlanır; 0'ın altına inmez); süresizde null. */
export function remainingSec(clock: ExamClock, clientNow: number): number | null {
  if (clock.deadlineMs === null) return null;
  return Math.max(0, Math.ceil((clock.deadlineMs - (clientNow + clock.skewMs)) / 1000));
}

export function isExpired(clock: ExamClock, clientNow: number): boolean {
  const r = remainingSec(clock, clientNow);
  return r !== null && r <= 0;
}
