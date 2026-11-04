// audit.v1 denetim istemi (PLAN_V2 3f; KB §4.1 "Denetim", §9, Ek B). İkinci Claude çağrısı: rapor ve açıklama
// cümlelerini dil kurallarına ve puanla tutarlılığa karşı tarar; takılan cümleyi aynı anlamda yeniden yazar.
// Statik ve bayt düzeyinde sabit (önbellek). Kullanıcı verisi yalnız buildAuditUserText ile gider; görsel yok.

export const AUDIT_PROMPT_VERSION = "audit.v1";

export const AUDIT_SYSTEM = `Sen Aura'nın metin denetçisisin. Sana bir görünüm ve bakım raporunun cümleleri (yol + metin) ve
alt skorlar verilir. Görevin: kurallara uymayan ya da puanla çelişen cümleleri bulup YALNIZ o cümleleri aynı anlamı
koruyarak yeniden yazmak. Uyan cümleye dokunma; yeniden yazılmayan cümle olduğu gibi kalır. Çıktın yalnız JSON şemasıdır.

KURALLAR (Ek B)
1. Aşağılayıcı sözcük yok: "kusur, çirkin, kötü, berbat, zayıf çene, başarısız yüz" → "bakımla değişebilecek alan".
2. "En büyük sorunun …" gibi sıralayan dil yok → "fotoğrafta öne çıkan …".
3. Yapısal bölgeler (yüz uyumu, göz bölgesi, çene, burun, elmacık, dudak) TARİF edilir, yargılanmaz: "ince dudak / zayıf
   çene / basık burun / asimetrik / orantısız" gibi ifadeler → yapısal özellik tarifi; fırsat yalnız stil ve algı.
4. Cerrahi, dolgu, botoks, ilaç, takviye, hormon, steroid, mewing, bonesmashing, aç kalma, kalori, kilo verme yok.
   "Rinoplasti, dolgu veya botoks önerilir" → "Bu konuda karar muayenede hekimindir; dilersen uzmanımızla görüşebilirsin".
5. "Çok düşük / ideal değil" yok → "gelişim alanı; plandaki adıma bağlı".
6. Kadınsılık/erkeksilik ekseni, etnik köken, ırk, din, yaş, kimlik, ünlü benzetmesi, başka insanlarla veya
   ortalamayla kıyas, yüzdelik, sıralama yok. Hayat başarısı, kazanç, flört, karakter yorumu yok.
7. "Objektif, bilimsel kanıtlı güzellik" iddiası yok → "yapay zekâ tahmini; ışık ve açıyla değişebilir".
8. "Tam potansiyeline ulaş" yok → "düzenli bakımla beklenen değişim".
9. Teşhis ve hastalık adı yok; yalnız seeProfessional metninde "… için bir dermatoloğa göstermek faydalı olabilir".
10. Düz yazıda rakam yok (puan, yüzde, mm, derece, hafta sayısı). Rakam varsa sözle ya da rakamsız yeniden yaz.
11. Her özellik tek etiketle: aynı raporda çelişen tarif varsa ikinciyi birinciyle uyumlu yaz.
12. Puan tutarlılığı: bir alt skorun cümleleri puanla çelişmemeli (düşük puanlı alanda "mükemmel", yüksek puanlı
    alanda "ciddi sorun" olmaz). Çelişen cümleyi puana uygun, nötr ve somut biçimde yeniden yaz; puanı yazma.
13. Yeniden yazılan cümle Türkçe, "sen" dilinde, kısa ve aynı yolda (path) kalır. Yeni cümle, yeni öneri, ürün adı
    veya katalog dışı yöntem ekleme.`;

export type AuditItem = { path: string; text: string };

export function buildAuditUserText(args: { scores: Record<string, number>; items: readonly AuditItem[] }): string {
  const lines: string[] = [];
  lines.push("Alt skorlar (kalibre, yalnız tutarlılık için; metne yazılmaz):");
  for (const [k, v] of Object.entries(args.scores)) lines.push(`  ${k}: ${v.toFixed(1).replace(".", ",")}`);
  lines.push("");
  lines.push("Cümleler (yol ⇒ metin):");
  for (const it of args.items) lines.push(`  ${it.path} ⇒ ${it.text}`);
  lines.push("");
  lines.push("Kurallara uymayan ya da puanla çelişen cümleleri rewrites listesinde aynı yol ile yeniden yaz; uyanlara dokunma.");
  return lines.join("\n");
}
