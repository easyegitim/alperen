/** accept_guardian_invite hata kodlarının Türkçe karşılığı (OGR-INV-00x; supabase/migrations/0017_rpc.sql). */
export function inviteErrorMessage(message: string | undefined): string {
  if (!message) return 'Davet kabul edilemedi. Biraz sonra yeniden dene.';
  if (message.includes('OGR-INV-002')) return 'Davetin süresi dolmuş. Öğrenciden yeni bir davet kodu iste.';
  if (message.includes('OGR-INV-003')) return 'Bu hesap veli hesabı değil. Veli olarak katılmak için farklı bir e-posta ile giriş yap.';
  if (message.includes('OGR-INV-001')) return 'Davet kodu bulunamadı ya da daha önce kullanılmış. Kodu öğrenciden yeniden iste.';
  return 'Davet kabul edilemedi. Biraz sonra yeniden dene.';
}
