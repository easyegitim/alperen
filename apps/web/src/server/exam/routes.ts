// Sınav (deneme) ekranlarının adresleri (saf; istemci ve sunucu kullanır).

export const examIntroHref = (examId: string): string => `/ogrenci/sinav/${examId}`;
export const examPlayHref = (examId: string, sessionId: string): string => `/ogrenci/sinav/${examId}/${sessionId}`;
/** Sonuç ekranı P2-D'dir (tek cümle sonuç + ısı haritası); oturum kimliğiyle açılır. */
export const examResultHref = (sessionId: string): string => `/ogrenci/sonuc?deneme=${sessionId}`;
