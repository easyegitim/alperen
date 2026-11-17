# Ders: TYT Matematik (eval bağlamı)

Bu blok eval için content/tyt-matematik verisinden üretilmiş bir ders bloğu kesitidir; üretimde ders bloğunu müfredat ve dossier katmanı kurar.

## Müfredat ağacı (kod · ad · tür)
- tyt.mat.temel · Temel matematik · düğüm
- tyt.mat.temel.sayilar · Sayı kümeleri, işlem önceliği, işaret kuralları · yaprak
- tyt.mat.temel.bolunebilme · Bölünebilme kuralları, kalan · yaprak
- tyt.mat.temel.ebob-ekok · EBOB–EKOK ve problemleri · yaprak
- tyt.mat.temel.rasyonel-sayilar · Rasyonel sayılarda dört işlem ve sıralama · yaprak
- tyt.mat.temel.ondalik · Ondalık gösterim, devirli ondalık, dönüşüm · yaprak
- tyt.mat.temel.uslu · Üslü ifadeler ve özellikleri · yaprak
- tyt.mat.temel.koklu · Köklü ifadeler, kök içine alma, eşlenik · yaprak
- tyt.mat.temel.carpanlara-ayirma · Çarpanlara ayırma ve özdeşlikler · yaprak
- tyt.mat.cebir · Cebir · düğüm
- tyt.mat.cebir.denklem · Birinci dereceden denklemler ve sistemler · yaprak
- tyt.mat.cebir.esitsizlik · Basit eşitsizlikler · yaprak
- tyt.mat.cebir.mutlak-deger · Mutlak değer: tanım, denklem, eşitsizlik · yaprak
- tyt.mat.cebir.oran-oranti · Oran–orantı, doğru/ters orantı · yaprak
- tyt.mat.problem · Problemler · düğüm
- tyt.mat.problem.sayi · Sayı problemleri · yaprak
- tyt.mat.problem.kesir · Kesir problemleri · yaprak
- tyt.mat.problem.yas · Yaş problemleri · yaprak
- tyt.mat.problem.yuzde · Yüzde, kâr–zarar · yaprak
- tyt.mat.problem.hareket · Hareket problemleri · yaprak
- tyt.mat.problem.isci · İşçi–havuz problemleri · yaprak

## Yanılgı etiketleri (etiket · kazanım · tanım)
- sayilar.islem-onceligi-soldan · tyt.mat.temel.sayilar · İşlem önceliğini atlayıp soldan sağa gidiyor.
- sayilar.negatif-carpim-isaret · tyt.mat.temel.sayilar · Negatif × negatif sonucunu negatif alıyor.
- sayilar.parantez-eksi-dagitma · tyt.mat.temel.sayilar · Parantez önündeki eksiyi dağıtmıyor.
- bolunebilme.3-ile-9-karistirma · tyt.mat.temel.bolunebilme · 9 ile bölünebilmeyi 3 kuralıyla kontrol ediyor.
- ebob-ekok.karistirma · tyt.mat.temel.ebob-ekok · EBOB ile EKOK'u yer değiştiriyor.
- rasyonel.pay-payda-ayri-toplama · tyt.mat.temel.rasyonel-sayilar · Payları ve paydaları ayrı ayrı topluyor.
- rasyonel.payda-esitlemeden-toplama · tyt.mat.temel.rasyonel-sayilar · Paydaları eşitlemeden payları topluyor.
- rasyonel.bolmede-ters-cevirmeme · tyt.mat.temel.rasyonel-sayilar · Kesirle bölmede ikinci kesri ters çevirmiyor.
- rasyonel.negatif-siralama-mutlak · tyt.mat.temel.rasyonel-sayilar · Negatif kesirleri mutlak değerlerine göre sıralıyor.
- ondalik.virgul-kaydirma-yon · tyt.mat.temel.ondalik · Virgül kaydırma yönünü karıştırıyor.
- uslu.usleri-carpma · tyt.mat.temel.uslu · Aynı tabanlı çarpımda üsleri çarpıyor.
- uslu.negatif-us-isaret · tyt.mat.temel.uslu · Negatif üssü sonucun işareti sanıyor.
- koklu.toplam-kok-icine · tyt.mat.temel.koklu · √a + √b'yi √(a+b) olarak topluyor.
- koklu.kok-icine-alma-kare · tyt.mat.temel.koklu · Katsayıyı kök içine alırken karesini almıyor.
- carpan.tam-kare-orta-terim · tyt.mat.temel.carpanlara-ayirma · (a+b)² açılımında 2ab terimini unutuyor.
- carpan.iki-kare-farki · tyt.mat.temel.carpanlara-ayirma · a²−b²'yi (a−b)² ile karıştırıyor.
- denklem.taraf-degistirme-isaret · tyt.mat.cebir.denklem · Terimi karşı tarafa işaret değiştirmeden geçiriyor.
- denklem.paydayla-carpma-eksik · tyt.mat.cebir.denklem · Paydadan kurtarırken tüm terimleri çarpmıyor.
- esitsizlik.negatifle-carpma-yon · tyt.mat.cebir.esitsizlik · Negatifle çarpınca eşitsizliğin yönünü çevirmiyor.
- mutlak.tek-durum · tyt.mat.cebir.mutlak-deger · Mutlak değer denkleminde tek durum alıyor.
- oran.ters-oran-dogru-gibi · tyt.mat.cebir.oran-oranti · Ters orantıyı doğru orantı gibi kuruyor.
- yuzde.ardisik-toplama · tyt.mat.problem.yuzde · Ardışık yüzdeleri topluyor.
- yuzde.kar-satis-uzerinden · tyt.mat.problem.yuzde · Kârı satış fiyatı üzerinden hesaplıyor.
- hareket.birim-donusumu · tyt.mat.problem.hareket · Saat–dakika dönüşümünü atlıyor.
- isci.sureleri-toplama · tyt.mat.problem.isci · İş sürelerini topluyor.
- kesir.kalan-butun-karistirma · tyt.mat.problem.kesir · Kalanın kesrini bütünün kesri sanıyor.
- genel.soruyu-yarim-okuma · genel · Sorulanı değil ara sonucu işaretliyor.
