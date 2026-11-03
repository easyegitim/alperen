# OneLineResult

Test ya da teşhis sonucu: önce tek cümle, altında "Neyi öğrendik" tek satır ve tek **Detay** açıcısı. Ayrıntı (adım merdiveni, kazanım, kanıt) varsayılan gizlidir.

**Sen sağlarsın:** `sentence` ("8 soruda 6 doğru. Takıldığın yer: eksi dağıtırken işaret."), `learned`, ve ayrıntı için ikisinden biri: `children` (Detay aynı yerde açar/kapatır; düğme `aria-expanded` + `aria-controls` taşır) ya da `onDetail` (Detay işlevi çağırır, ör. ayrı sayfa açar). İkisi de yoksa Detay düğmesi çizilmez. `detailLabel` varsayılanı "Detay".

- Sayılar kelimeyle yazılır ("6 doğru"), yüzde yok. Ünlem ve emoji yok; sonuç suçlamaz.
- Tipik kullanım: `<OneLineResult …><StepLadder collapsible={false} … /></OneLineResult>`.
