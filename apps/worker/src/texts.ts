/**
 * Tüm kullanıcı metinleri tek dosyada (packages/design-system/telegram.md'ye birebir).
 * Kurallar: "sen" hitabı, sıcak ama ciddi; emoji ve ünlem işareti yok (bu dosyada hiç ünlem
 * karakteri bulunmaz, kabul komutu dosyayı tarar); mesaj ≤ 4 satır; düğme ≤ 20 karakter, fiille
 * başlar, mesajda ≤ 3 düğme. Yalnız **kalın** ve `kod` biçimi. ✓ ✕ ★ · işaretleri serbest.
 * Aydınlatma metninin çocuk dili paragrafı burada YOKTUR: /gizlilik onu legal_texts'ten okur.
 */

export const START_SENTENCE = "Merhaba, ben Öğrenmen. easy'nin yapay zekâ öğretmeniyim; hocaların da bu grupta.";

export const buttons = {
  ageAdult: '18 yaşından büyüğüm',
  ageMinor: '18 yaşından küçüğüm',
  readText: 'Metni oku',
  approve: 'Onaylıyorum',
  notNow: 'Şimdi değil',
  startTest: 'Teste başla',
  later: 'Sonra',
  staySocratic: 'Sokratik kal',
  direct: 'Doğrudan cevap',
  cancel: 'Vazgeç',
  hint: 'İpucu al',
  askInstructor: 'Hocaya sor',
  showSolution: 'Cevabı göster',
} as const;

export const texts = {
  start: START_SENTENCE,
  ageQuestion: 'Başlamadan önce bir şey sormam gerekiyor: 18 yaşından büyük müsün? Doğum yılını sormuyorum.',
  consentSummary: (days: number): string =>
    [
      '**Aydınlatma özeti**',
      'Yazdıklarını sana daha iyi yardım etmek için saklarız; adın ve okulun yapay zekâya gitmez.',
      `Mesajların ${days} gün sonra silinir; istediğin zaman /sil yazabilirsin.`,
      'Metni okuyabilir, onaylayabilir ya da şimdilik geçebilirsin.',
    ].join('\n'),
  consentLater: 'Tamam. Hazır olduğunda /start yazman yeterli.',
  consentRequired: 'Sana yardımcı olabilmem için önce onay vermen gerekiyor. /start yazarak devam edebilirsin.',
  guardianNeeded:
    'Velinin onayı gerekiyor. Koordinatörden aldığın kodu velin kendi Telegram hesabından `/veli KOD` ile girebilir ya da sana gönderilen bağlantıyı açabilir.',
  guardianApprovedStudent: 'Velin onayladı, başlayabiliriz.',
  guardianRecorded: 'Onayınız kaydedildi.',
  guardianInvalid: 'Kod geçersiz ya da süresi dolmuş; koordinatörden yeni kod isteyebilirsiniz.',
  guardianUsage: 'Kodu `/veli KOD` biçiminde yazabilirsiniz.',
  guardianSelf: 'Bu kod öğrencinin kendi hesabından girilemez; velinin kendi Telegram hesabı gerekiyor.',
  staffLinked: (username: string): string => `Hesabını eğitmen olarak bağladım; gruplarda @${username} ile etiketleneceksin.`,
  staffInvalid: 'Kod geçersiz ya da süresi dolmuş; koordinatörden yeni kod isteyebilirsin.',
  staffUsage: 'Kodu `/egitmen KOD` biçiminde özel sohbette yazabilirsin.',
  startFirst: 'Başlamak için bana özelden /start yaz.',
  privateOnly: 'Bu komut yalnız özel sohbette çalışır; bana özelden yazabilirsin.',
  unknownCommand: 'Bu komutu tanımıyorum; /yardim yazarak komutları görebilirsin.',

  diagOffer: 'Seni tanımak için 20 soruluk kısa bir test var. Başlayalım mı?',
  diagLater: 'Tamam. Hazır olduğunda /test yazman yeterli.',
  diagItem: (idx: number, total: number, stem: string): string => `Soru ${idx}/${total} · ${stem}`,
  figureCaption: (alt: string): string => `Şekil: ${alt}`,
  diagDoneHead: '✓ Teşhis testi bitti. Teşekkür ederim.',
  diagWeakest: (names: readonly string[]): string => `Önce birlikte çalışacağımız konular: ${names.join(', ')}.`,
  diagNoPercent: 'Yüzdeleri, her konuda yeterli kanıt toplandığında göstereceğim.',
  diagNext: 'Pratik için /test, soru sormak için doğrudan yazabilirsin.',
  diagAlreadyRunning: 'Teşhis testine kaldığın yerden devam ediyoruz.',

  correct: (reason: string): string => `✓ Doğru. ${reason}`,
  wrong: (reason: string): string => `✕ Tekrar dene. ${reason}`,
  genericRight: 'Aynı yolla devam edebilirsin.',
  genericWrong: 'Bu şıkta bir adım kaçmış; çözümü adım adım birlikte kontrol edelim.',
  solution: (text: string): string => `Çözüm: ${text}`,
  answerAlready: 'Bu soruyu zaten cevapladın.',
  answerClosed: 'Bu soru artık açık değil.',
  practiceEmpty: 'Bugün için uygun pratik sorusu kalmadı; hocan yeni soru ekleyince haber vereceğim.',
  practiceDone: (correct: number, total: number): string =>
    `Set bitti: ${total} sorunun ${correct} tanesini doğru yaptın. Yeni set için /test yazabilirsin.`,
  testQuotaFull: (limit: number): string => `Bugünlük test hakkın doldu (${limit}/${limit}). Yarın 00:00'da yenilenir.`,

  cevapOn: 'Tamam, bu soruda çözümü doğrudan göstereceğim.',
  cevapNone: 'Şu an açık bir soru yok; bir soru sor, sonra /cevap yazabilirsin.',
  modeAsk: 'Hangi modda devam edelim? Sokratik modda ipucuyla ilerleriz, doğrudan modda çözümü adım adım gösteririm.',
  modeSocratic: 'Tamam, Sokratik modda devam ediyoruz.',
  modeDirect: 'Tamam, bundan sonra çözümleri adım adım doğrudan göstereceğim.',

  progressHead: 'İlerlemen (yüzde yalnız yeterli kanıt olan konularda):',
  progressLine: (name: string, value: string): string => `${name} · ${value}`,
  progressNoEvidence: 'henüz yeterli kanıt yok',
  progressEmpty: 'Henüz ölçüm yok; /test ile başlayabilirsin.',

  hocaGroup: (handle: string): string => `Bunu hocana bırakıyorum. ${handle}, bu soruya bakabilir misin?`,
  hocaPrivateAiOnly: 'Hocana ilettim; cevabı burada göreceksin. Hocan uygun olduğunda yanıtlar.',
  hocaPrivateAdvisor: (sla: number): string => `Hocana ilettim; cevabı burada göreceksin. Hocan genellikle ${sla} saat içinde yanıtlar.`,
  hocaFallbackHandle: 'hocan',

  kota: (msgUsed: number, msgLimit: number, testUsed: number, testLimit: number): string =>
    `Bugün ${msgUsed}/${msgLimit} mesaj, ${testUsed}/${testLimit} test kullandın. Yarın 00:00'da yenilenir.`,
  durdur: 'Hatırlatmaları kapattım. /baslat ile yeniden açabilirsin.',
  baslat: 'Hatırlatmaları açtım.',
  silAsk: 'Verilerinin silinmesini istiyor musun? Talebin koordinatöre gider ve 30 gün içinde tamamlanır.',
  silDone: 'Talebini koordinatöre ilettim; 30 gün içinde tamamlanır.',
  silCancel: 'Tamam, hiçbir şey silinmedi.',

  oncelikHead: (course: string, period: string, years: number): string =>
    `**Sıklık analizine göre öncelikler** · ${course} · ${period} · ${years} yılın arşivi`,
  oncelikRow: (rank: number, topic: string, kind: string, years: number, total: number, points: string, evidence: number): string =>
    `${rank}. ${topic} · ${kind} · ${years}/${total} yıl · ${points} · kanıt ${evidence}`,
  oncelikNote: 'Bu liste geçmiş sınavların sıklık analizidir; hangi sorunun geleceğini söylemez.',
  oncelikNone: 'Bu ders için henüz onaylı bir öncelik listesi yok.',

  arastirClosed: 'Araştırma özelliği hesabında kapalı; hocana sorabilirsin.',
  arastirQueued: 'Araştırmanı sıraya aldım; eğitmen incelemesinden sonra burada paylaşırım.',
  arastirUsage: 'Sorunu `/arastir soru` biçiminde yazabilirsin.',
  researchMore: 'Kaynaklar aşağıda.',

  help: [
    'Komutlar: /test teşhis ya da pratik, /ilerleme konulara göre durumun, /kota bugünkü hakların.',
    '/cevap açık soruda çözümü gösterir, /mod Sokratik ya da doğrudan mod, /hoca soruyu hocana iletir.',
    '/durdur ve /baslat hatırlatmalar, /oncelik sınav öncelikleri, /arastir araştırma isteği, /sil silme talebi.',
    'Verilerin nasıl kullanılıyor? /gizlilik yazabilirsin.',
  ].join('\n'),
  privacyFallback: 'Gizlilik metnine şu an ulaşamıyorum; koordinatörüne sorabilirsin.',

  voice: 'Şimdilik yazılı mesajları okuyabiliyorum.',
  truncated: 'Mesajını kısaltarak okudum.',
  burst: 'İki mesajını birlikte okudum.',
  quotaWarn: (remaining: number): string => `${remaining} mesaj hakkın kaldı; yarın 00:00'da yenilenir.`,
  quotaFull: (limit: number): string =>
    `Bugünlük mesaj hakkın doldu (${limit}/${limit}). Yarın 00:00'da yenilenir. Acil bir sorun varsa hocanı etiketleyebilirsin.`,
  staffQuotaFull: 'Bugünlük soru hakkınız doldu; yarın yenilenir.',
  degraded: 'Şu an yanıt veremiyorum; birkaç dakika sonra tekrar dene. Acilse hocanı etiketleyebilirsin.',
  unsure: 'Bundan emin değilim; hocana soralım.',
  handoff: 'Bunu hocan söyleyebilir; sorunu ona ilettim.',
  instructorNote: (text: string): string => `Hocanın notu: '${text}'`,
  memoryDate: (text: string): string => `Not defterimde şu kayıtlı: ${text} Emin olmak için hocana da sorabilirsin.`,
  continueQuestion: 'Buraya kadar anlaşıldı mı?',

  groupConsentPrompt: (username: string | null, link: string): string =>
    `${username === null ? 'Merhaba' : '@' + username}, sana yardımcı olabilmem için önce özel mesajdan onay vermen gerekiyor: ${link}`,
  newMemberHint: 'Botla özelden /start yazarak onay verebilirsin.',
  /** `legal_texts(grup_kayit)` okunamazsa gruba giden kısa bildirim (docs/hukuk/grup-kayit-bildirimi.md kısa sürüm). */
  recordingNoticeFallback: (days: number): string =>
    [`Bu gruptaki mesajlar Öğrenmen tarafından kaydedilir ve ${days} gün sonra silinir.`, 'Öğrenmen bir yapay zekâ öğretmenidir; hocalar da bu grupta.', 'Ayrıntı: /gizlilik'].join('\n'),
  /** [İpucu al] düğmesinde öğrenci adına modele giden istek (ipucu düzeyi oturumda bir artar). */
  hintRequest: 'Bir ipucu daha istiyorum.',

  proactive: {
    exam_tomorrow: (topic: string | null): string =>
      topic === null
        ? 'Yarın deneme var. 10 dakikalık bir tekrar ister misin?'
        : `Yarın deneme var. Son çalıştığın konu ${topic}; 10 dakikalık bir tekrar ister misin?`,
    deadline_soon: (what: string | null): string =>
      what === null ? 'Bir teslim tarihin yaklaşıyor. Bugün kısa bir hazırlık yapalım mı?' : `Yaklaşan bir teslim var: ${what} Bugün kısa bir hazırlık yapalım mı?`,
    silent_3d: 'Birkaç gündür görüşemedik. Bugün 5 dakikalık kısa bir soruyla devam edelim mi?',
    video_deleted_student: 'Ders kaydının videosu saklama süresi dolduğu için silindi; isimsiz transkript kalıyor.',
    video_deleted_guardian: 'Öğrencinizin ders kaydı videosu saklama süresi dolduğu için silindi; isimsiz transkript kalıyor.',
    priority_plan_ready: 'Dersin için öncelik listesi hazır: /oncelik',
  },

  ops: {
    privacyOn: 'Grup gizlilik modu açık; bot yalnız etiketlenince görür',
    notAdmin: 'Bot grupta yönetici değil; kayıt bildirimi sabitlenemedi',
    practiceEmpty: (skill: string): string => `Pratik stoku bitti: ${skill}`,
    spend: (month: string, monthUsd: string, cap: string, pct: string, dayUsd: string, freeShare: string): string =>
      `${month}: ${monthUsd} / ${cap} (${pct}). Bugün ${dayUsd}. Ücretsiz pay ${freeShare}.`,
    spendState: (state: string): string => `Harcama durumu değişti: ${state}.`,
    lessonSpend: (used: string, cap: string): string => `Ders analizi: ${used} / ${cap}`,
    health: (problems: string): string => `Sağlık denetimi: ${problems}.`,
    providerConfig: (provider: string, code: string): string => `Sağlayıcı yapılandırma hatası: ${provider} (${code}); gün sonuna kadar zincir dışında.`,
  },
} as const;

/** Ay adları (kurucu DM'i "Ekim: 12,4 $ / 24 $"). */
export const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'] as const;

/** Plan satırı türü ("çoktan seçmeli" vb.) olduğu gibi yazılır; boşsa "diğer". */
export function kindLabel(kind: string | null | undefined): string {
  return kind === null || kind === undefined || kind === '' ? 'diğer' : kind;
}
