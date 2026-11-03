// Koç sohbeti: sunucu (src/server/chat) ile istemci (src/components/chat) arasında paylaşılan tipler ve metinler.

export type ChatMode = 'hint' | 'explain' | 'solve';

/** Ekranda bir balon. */
export interface DisplayMessage {
  id: string;
  from: 'tutor' | 'student';
  text: string;
  attachments: { id: string; kind: 'photo' | 'pdf' }[];
  /** Eğitmene yönlendirildi (ret ya da koçun kararı). */
  escalated: boolean;
  /** Teşhisten açıldı (Koça sor). */
  seeded: boolean;
}

/** Sayfanın istemciye verdiği başlangıç durumu. */
export interface ChatBootstrap {
  /** Koç kullanılabilir mi (sunucu yapılandırıldı ve öğrenci kaydı var). */
  available: boolean;
  conversationId: string | null;
  mode: ChatMode;
  messages: DisplayMessage[];
  /** Koç bu sohbette önceki bir mesaja hâlâ yanıt veriyor (başka sekme ya da sayfadan ayrılıp dönme). */
  pending: boolean;
  /** "Koça sor" bağlamı (/ogrenci/koc?seed=…). */
  seed: { id: string; summary: string | null; attachments: { id: string; kind: 'photo' | 'pdf' }[] } | null;
}

/**
 * Ek sınırları (sunucu `src/server/chat/request.ts` denetler; istemci fotoğrafı bu sınıra sığana dek küçültür).
 * Fotoğraf: Anthropic görsel bloğu base64 hâliyle en çok 5 MB alır → ham en çok 3,75 MB. PDF: en çok 4 MB ve 100 sayfa.
 */
export const CHAT_UPLOAD_LIMITS = {
  photoBytes: 3.75 * 1024 * 1024,
  pdfBytes: 4 * 1024 * 1024,
  pdfPages: 100,
} as const;

export const MODE_NAMES: Record<ChatMode, string> = { hint: 'İpucu', explain: 'Açıkla', solve: 'Çözümü göster' };

export const CHAT_COPY = {
  welcome:
    'Merhaba. Ben senin AI koçunum. Takıldığın bir soruyu fotoğrafla ya da buraya yaz; önce ipucu veririm, çözümü görmek istersen sen seçersin.',
  seedPrompt: 'Bu soruda nerede yanlış yaptım?',
  seedChip: 'Teşhisin eklendi',
  escalated: 'Bu konuyu hocana ilettim.',
  unavailable: 'Koç şu an kullanılamıyor. Biraz sonra yeniden dene.',
  genericError: 'Mesaj gönderilemedi. Bağlantını kontrol edip yeniden dene.',
  sessionExpired: 'Oturumun kapanmış. Yeniden giriş yap.',
  turnInProgress: 'Koç önceki mesajına yanıt veriyor. Biraz bekle.',
  uploadError: 'Eklenemedi',
  tooManyAttachments: (max: number) => `Bir mesaja en çok ${max} ek konabilir.`,
  modeSuggestion: (mode: ChatMode) => `${MODE_NAMES[mode]} moduna geç`,
} as const;
