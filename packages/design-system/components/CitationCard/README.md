# CitationCard

Araştırma ajanının bulduğu bir kaynak: başlık, yazarlar, yayın, yıl, DOI ve doğrulama durumu.

**Sen sağlarsın:** `title`, `authors`, `venue`, `year`, `doi`, `verified` (Crossref'te çözümlendi mi), isteğe bağlı `tldr` (tek cümle özet), `pdfUrl` (Unpaywall'dan açık erişim PDF) ve `actions`.

- `verified` yalnızca Crossref'in çözdüğü DOI için `true` olur; kart o zaman "✓ Crossref doğruladı" taşır ve DOI tıklanabilir.
- `verified={false}` kart **öğrenciye gösterilmez**; yalnızca araştırma inceleme ekranında, `danger` kenarla ve "kaldırılacak" ibaresiyle durur. Uydurma kaynak bu alandaki en büyük risktir.
- DOI'si olmayan kaynak (tez, DergiPark makalesi) "DOI yok" yazar ve doğrulama rozeti taşımaz; kaynağın kendi bağlantısı `actions` ile verilir.
- Yazar · yayın · yıl sırası sabittir; APA/BibTeX dışa aktarımı kartın dışında, listenin üstünde tek düğmedir.
