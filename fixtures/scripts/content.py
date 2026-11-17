"""Dev-seed içerik dilimi: kazanımlar, ön koşullar, yanılgı etiketleri, teşhis ve şablon soruları.

Kaynak: BLUEPRINT §10.1 (kazanım ağacı), §10.2 (27 etiket), §10.3 (teşhis stratejisi), §10.4 (şablonlar).
Gerçek içerik `content/tyt-matematik/` (M03) içindedir; burası Worker FakeDb ve panel mock'unun
aynı dünyayı görmesi için küçük, kendi içinde tutarlı bir kopyadır.
"""

from __future__ import annotations

from typing import Any

from fxlib import CURRICULUM_CODE, CURRICULUM_ID, sha256_hex, uid

P = "tyt.mat."

# id, ad, parent, ön koşullar [(id, strength)]
SKILL_ROWS: list[tuple[str, str, str | None, list[tuple[str, float]]]] = [
    ("temel", "Temel matematik", None, []),
    ("temel.sayilar", "Sayı kümeleri, işlem önceliği, işaret kuralları", "temel", []),
    ("temel.bolunebilme", "Bölünebilme kuralları, kalan", "temel", [("temel.sayilar", 1.0)]),
    ("temel.ebob-ekok", "EBOB–EKOK ve problemleri", "temel", [("temel.bolunebilme", 1.0)]),
    ("temel.rasyonel-sayilar", "Rasyonel sayılarda dört işlem ve sıralama", "temel",
     [("temel.sayilar", 1.0), ("temel.ebob-ekok", 0.6)]),
    ("temel.ondalik", "Ondalık gösterim, devirli ondalık, dönüşüm", "temel", [("temel.rasyonel-sayilar", 0.8)]),
    ("temel.uslu", "Üslü ifadeler ve özellikleri", "temel", [("temel.sayilar", 1.0)]),
    ("temel.koklu", "Köklü ifadeler, kök içine alma, eşlenik", "temel", [("temel.uslu", 1.0)]),
    ("temel.carpanlara-ayirma", "Çarpanlara ayırma ve özdeşlikler", "temel", [("temel.uslu", 0.8)]),
    ("cebir", "Cebir", None, []),
    ("cebir.denklem", "Birinci dereceden denklemler ve sistemler", "cebir",
     [("temel.sayilar", 1.0), ("temel.rasyonel-sayilar", 0.8)]),
    ("cebir.esitsizlik", "Basit eşitsizlikler", "cebir", [("cebir.denklem", 1.0)]),
    ("cebir.mutlak-deger", "Mutlak değer: tanım, denklem, eşitsizlik", "cebir",
     [("cebir.esitsizlik", 0.9), ("temel.sayilar", 0.6)]),
    ("cebir.oran-oranti", "Oran–orantı, doğru/ters orantı", "cebir", [("temel.rasyonel-sayilar", 0.9)]),
    ("problem", "Problemler", None, []),
    ("problem.sayi", "Sayı problemleri", "problem", [("cebir.denklem", 1.0)]),
    ("problem.kesir", "Kesir problemleri", "problem", [("temel.rasyonel-sayilar", 1.0), ("cebir.denklem", 0.7)]),
    ("problem.yas", "Yaş problemleri", "problem", [("problem.sayi", 0.9)]),
    ("problem.yuzde", "Yüzde, kâr–zarar", "problem", [("cebir.oran-oranti", 1.0), ("temel.ondalik", 0.7)]),
    ("problem.hareket", "Hareket problemleri", "problem", [("cebir.oran-oranti", 0.9), ("cebir.denklem", 0.8)]),
    ("problem.isci", "İşçi–havuz problemleri", "problem",
     [("cebir.oran-oranti", 0.8), ("temel.rasyonel-sayilar", 0.6)]),
]


def sk(short: str) -> str:
    return P + short


def skills() -> list[dict[str, Any]]:
    out = []
    for i, (sid, name, parent, _pre) in enumerate(SKILL_ROWS):
        out.append({
            "curriculum_id": CURRICULUM_ID, "id": sk(sid), "parent_id": sk(parent) if parent else None,
            "name": name, "description": None, "is_leaf": parent is not None, "order_no": i + 1,
            "p_init": 0.3, "p_learn": 0.1, "p_guess": 0.25, "p_slip": 0.1,
        })
    return out


def prerequisites() -> list[dict[str, Any]]:
    out = []
    for sid, _n, _p, pre in SKILL_ROWS:
        for pid, strength in pre:
            out.append({"curriculum_id": CURRICULUM_ID, "skill_id": sk(sid), "prereq_id": sk(pid),
                        "strength": strength, "source": "curriculum"})
    return out


def skill_name(skill_id: str) -> str:
    for sid, name, _p, _pre in SKILL_ROWS:
        if sk(sid) == skill_id:
            return name
    raise KeyError(skill_id)


# tag, kazanım (kısa; None = genel), ön koşul (kısa), eğitmen metni, öğrenci metni
TAG_ROWS: list[tuple[str, str | None, str | None, str, str]] = [
    ("sayilar.islem-onceligi-soldan", "temel.sayilar", None, "İşlem önceliğini atlayıp soldan sağa gidiyor.",
     "Çarpma ve bölmeyi toplama ve çıkarmadan önce yapıyoruz."),
    ("sayilar.negatif-carpim-isaret", "temel.sayilar", None, "Negatif × negatif sonucunu negatif alıyor.",
     "İki negatifin çarpımı pozitif olur."),
    ("sayilar.parantez-eksi-dagitma", "temel.sayilar", None, "Parantez önündeki eksiyi dağıtmıyor.",
     "Eksi işareti parantezdeki her terime dağılır."),
    ("bolunebilme.3-ile-9-karistirma", "temel.bolunebilme", None,
     "9 ile bölünebilmeyi 3 kuralıyla kontrol ediyor.", "9'a bölünebilme için rakamlar toplamı 9'un katı olmalı."),
    ("ebob-ekok.karistirma", "temel.ebob-ekok", "temel.bolunebilme", "EBOB ile EKOK'u yer değiştiriyor.",
     "En büyük ortak bölen küçüğü, EKOK büyüğü verir."),
    ("rasyonel.pay-payda-ayri-toplama", "temel.rasyonel-sayilar", None, "Payları ve paydaları ayrı ayrı topluyor.",
     "Paylar ve paydalar ayrı ayrı toplanmaz; önce paydaları eşitleyelim."),
    ("rasyonel.payda-esitlemeden-toplama", "temel.rasyonel-sayilar", "temel.ebob-ekok",
     "Paydaları eşitlemeden payları topluyor.", "Toplamadan önce paydaları eşitlemen gerekiyor."),
    ("rasyonel.bolmede-ters-cevirmeme", "temel.rasyonel-sayilar", None,
     "Kesirle bölmede ikinci kesri ters çevirmiyor.", "Kesirle bölerken ikinci kesri ters çevirip çarpıyoruz."),
    ("rasyonel.negatif-siralama-mutlak", "temel.rasyonel-sayilar", "temel.sayilar",
     "Negatif kesirleri mutlak değerlerine göre sıralıyor.", "Negatif sayılarda mutlak değeri büyük olan daha küçüktür."),
    ("ondalik.virgul-kaydirma-yon", "temel.ondalik", "temel.rasyonel-sayilar", "Virgül kaydırma yönünü karıştırıyor.",
     "10 ile çarparken virgül bir basamak sağa gider."),
    ("uslu.usleri-carpma", "temel.uslu", None, "Aynı tabanlı çarpımda üsleri çarpıyor.", "Tabanlar aynıysa üsler toplanır."),
    ("uslu.negatif-us-isaret", "temel.uslu", "temel.sayilar", "Negatif üssü sonucun işareti sanıyor.",
     "Negatif üs tersini alır, işareti değiştirmez."),
    ("koklu.toplam-kok-icine", "temel.koklu", "temel.uslu", "√a + √b'yi √(a+b) olarak topluyor.",
     "√a + √b, √(a+b) değildir."),
    ("koklu.kok-icine-alma-kare", "temel.koklu", "temel.uslu", "Katsayıyı kök içine alırken karesini almıyor.",
     "Katsayı kök içine karesi alınarak girer."),
    ("carpan.tam-kare-orta-terim", "temel.carpanlara-ayirma", "temel.uslu", "(a+b)² açılımında 2ab terimini unutuyor.",
     "Kare açarken ortadaki 2ab terimini ekleyelim."),
    ("carpan.iki-kare-farki", "temel.carpanlara-ayirma", None, "a²−b²'yi (a−b)² ile karıştırıyor.",
     "a²−b² = (a−b)(a+b) olur."),
    ("denklem.taraf-degistirme-isaret", "cebir.denklem", "temel.sayilar",
     "Terimi karşı tarafa işaret değiştirmeden geçiriyor.", "Terim karşı tarafa geçerken işareti değişir."),
    ("denklem.paydayla-carpma-eksik", "cebir.denklem", "temel.rasyonel-sayilar",
     "Paydadan kurtarırken tüm terimleri çarpmıyor.", "Paydayla çarparken her terimi çarpıyoruz."),
    ("esitsizlik.negatifle-carpma-yon", "cebir.esitsizlik", "cebir.denklem",
     "Negatifle çarpınca eşitsizliğin yönünü çevirmiyor.", "Eşitsizliği negatifle çarparsan yön değişir."),
    ("mutlak.tek-durum", "cebir.mutlak-deger", "cebir.esitsizlik", "Mutlak değer denkleminde tek durum alıyor.",
     "İçerideki ifade hem pozitif hem negatif olabilir; iki durum var."),
    ("oran.ters-oran-dogru-gibi", "cebir.oran-oranti", "temel.rasyonel-sayilar",
     "Ters orantıyı doğru orantı gibi kuruyor.", "Biri artarken diğeri azalıyorsa ters orantı var."),
    ("yuzde.ardisik-toplama", "problem.yuzde", "cebir.oran-oranti", "Ardışık yüzdeleri topluyor.",
     "%20 sonra %10 artış, %30 değildir; sırayla uygula."),
    ("yuzde.kar-satis-uzerinden", "problem.yuzde", None, "Kârı satış fiyatı üzerinden hesaplıyor.",
     "Kâr yüzdesi maliyet üzerinden hesaplanır."),
    ("hareket.birim-donusumu", "problem.hareket", None, "Saat–dakika dönüşümünü atlıyor.",
     "Hız km/sa ise süreyi saate çevir."),
    ("isci.sureleri-toplama", "problem.isci", "temel.rasyonel-sayilar", "İş sürelerini topluyor.",
     "Birlikte çalışırken birim zamandaki işler toplanır, süreler değil."),
    ("kesir.kalan-butun-karistirma", "problem.kesir", "temel.rasyonel-sayilar",
     "Kalanın kesrini bütünün kesri sanıyor.", "\"Kalanın yarısı\" bütünün değil kalanın yarısıdır."),
    ("genel.soruyu-yarim-okuma", None, None, "Sorulanı değil ara sonucu işaretliyor.",
     "Soru neyi istiyor, son adımda tekrar bak."),
]


def misconception_tags() -> list[dict[str, Any]]:
    return [{"tag": t, "curriculum_id": CURRICULUM_ID, "skill_id": sk(s) if s else None,
             "prereq_skill_id": sk(p) if p else None, "text_instructor": ti, "text_student": ts,
             "created_at": "2026-10-01T00:00:00Z"} for t, s, p, ti, ts in TAG_ROWS]


def tag_info(tag: str) -> tuple[str | None, str | None, str, str]:
    for t, s, p, ti, ts in TAG_ROWS:
        if t == tag:
            return (sk(s) if s else None, sk(p) if p else None, ti, ts)
    raise KeyError(tag)


# --- Teşhis maddeleri (20; §10.3 sırası; her madde 4 şık, 2 etiketli + 1 etiketsiz çeldirici) ----------------
# (skill, difficulty, stem, [(key, text, tag)], correct, canonical_expr, numeric_value, solution)
D = "temel."
C = "cebir."
R = "problem."
DIAG: list[tuple[str, float, str, list[tuple[str, str, str | None]], str, str, str, str]] = [
    (D + "sayilar", 0.5, "`-3 + 4 · (-2)` işleminin sonucu kaçtır?",
     [("A", "`-11`", None), ("B", "`-2`", "sayilar.islem-onceligi-soldan"), ("C", "`5`", "sayilar.negatif-carpim-isaret"),
      ("D", "`-5`", None)], "A", "-3 + 4*(-2)", "-11", "Önce çarpma: `4 · (-2) = -8`; sonra `-3 + (-8) = -11`."),
    (D + "bolunebilme", 0.5, "Dört basamaklı `7a52` sayısı 9 ile tam bölünebiliyorsa `a` kaçtır?",
     [("A", "`1`", "bolunebilme.3-ile-9-karistirma"), ("B", "`4`", None), ("C", "`18`", "genel.soruyu-yarim-okuma"),
      ("D", "`6`", None)], "B", "18 - (7 + 5 + 2)", "4",
     "Rakamlar toplamı `7 + a + 5 + 2 = 14 + a` 9'un katı olmalı; `14 + 4 = 18` olduğundan `a = 4`."),
    (D + "rasyonel-sayilar", 0.3, "`1/2 + 1/3` işleminin sonucu kaçtır?",
     [("A", "`2/5`", "rasyonel.pay-payda-ayri-toplama"), ("B", "`1/6`", None), ("C", "`5/6`", None),
      ("D", "`2/3`", "rasyonel.payda-esitlemeden-toplama")], "C", "Rational(1,2)+Rational(1,3)", "5/6",
     "Paydaları 6'da eşitle: `3/6 + 2/6 = 5/6`."),
    (D + "uslu", 0.5, "`2^3 · 2^(-1)` ifadesinin değeri kaçtır?",
     [("A", "`1/8`", "uslu.usleri-carpma"), ("B", "`-16`", "uslu.negatif-us-isaret"), ("C", "`4`", None),
      ("D", "`16`", None)], "C", "2**3 * 2**(-1)", "4", "Tabanlar aynı, üsler toplanır: `2^(3 - 1) = 2^2 = 4`."),
    (C + "denklem", 0.5, "`3x - 5 = 2x + 4` ise `x + 1` kaçtır?",
     [("A", "`9`", "genel.soruyu-yarim-okuma"), ("B", "`0`", "denklem.taraf-degistirme-isaret"), ("C", "`8`", None),
      ("D", "`10`", None)], "D", "9 + 1", "10", "`3x - 2x = 4 + 5` olduğundan `x = 9`; sorulan `x + 1 = 10`."),
    (D + "sayilar", 0.3, "`-(4 - 7) + 2` işleminin sonucu kaçtır?",
     [("A", "`-1`", "sayilar.negatif-carpim-isaret"), ("B", "`5`", None), ("C", "`-9`", "sayilar.parantez-eksi-dagitma"),
      ("D", "`1`", None)], "B", "-(4 - 7) + 2", "5", "Parantez: `4 - 7 = -3`; `-(-3) = 3`; `3 + 2 = 5`."),
    (D + "rasyonel-sayilar", 0.5, "`3/4 + 1/8` işleminin sonucu kaçtır?",
     [("A", "`4/12`", "rasyonel.pay-payda-ayri-toplama"), ("B", "`7/8`", None),
      ("C", "`4/8`", "rasyonel.payda-esitlemeden-toplama"), ("D", "`3/32`", None)], "B",
     "Rational(3,4)+Rational(1,8)", "7/8", "Paydaları 8'de eşitle: `6/8 + 1/8 = 7/8`."),
    (D + "ebob-ekok", 0.5, "12 ve 18 sayılarının EKOK'u kaçtır?",
     [("A", "`6`", "ebob-ekok.karistirma"), ("B", "`36`", None), ("C", "`216`", None),
      ("D", "`18`", "genel.soruyu-yarim-okuma")], "B", "ilcm(12, 18)", "36",
     "`12 = 2^2 · 3`, `18 = 2 · 3^2`; en büyük kuvvetler `2^2 · 3^2 = 36`."),
    (D + "uslu", 0.3, "`10^(-2)` sayısı aşağıdakilerden hangisidir?",
     [("A", "`-100`", "uslu.negatif-us-isaret"), ("B", "`-20`", "uslu.usleri-carpma"), ("C", "`-1/100`", None),
      ("D", "`1/100`", None)], "D", "10**(-2)", "1/100", "Negatif üs tersini alır: `10^(-2) = 1/10^2 = 1/100`."),
    (D + "ondalik", 0.5, "`0,045 · 100` işleminin sonucu kaçtır?",
     [("A", "`4,5`", None), ("B", "`0,00045`", "ondalik.virgul-kaydirma-yon"), ("C", "`45`", None),
      ("D", "`0,45`", "genel.soruyu-yarim-okuma")], "A", "Rational(45,1000)*100", "9/2",
     "100 ile çarparken virgül iki basamak sağa gider: `0,045 → 4,5`."),
    (C + "denklem", 0.3, "`x/2 + 1 = 4` denkleminin çözümü kaçtır?",
     [("A", "`10`", "denklem.taraf-degistirme-isaret"), ("B", "`3`", None), ("C", "`7`", "denklem.paydayla-carpma-eksik"),
      ("D", "`6`", None)], "D", "(4 - 1)*2", "6", "`x/2 = 4 - 1 = 3`; iki tarafı 2 ile çarp: `x = 6`."),
    (D + "koklu", 0.5, "`√12 + √3` ifadesinin değeri kaçtır?",
     [("A", "`√15`", "koklu.toplam-kok-icine"), ("B", "`3√3`", None), ("C", "`√6 + √3`", "koklu.kok-icine-alma-kare"),
      ("D", "`5√3`", None)], "B", "sqrt(12) + sqrt(3)", "3*sqrt(3)", "`√12 = 2√3`; `2√3 + √3 = 3√3`."),
    (D + "carpanlara-ayirma", 0.5, "`(x + 3)^2` ifadesinin açılımı hangisidir?",
     [("A", "`x^2 + 9`", "carpan.tam-kare-orta-terim"), ("B", "`x^2 + 3x + 9`", None), ("C", "`x^2 + 6x + 9`", None),
      ("D", "`x^2 - 9`", "carpan.iki-kare-farki")], "C", "expand((x + 3)**2)", "x**2 + 6*x + 9",
     "`(a + b)^2 = a^2 + 2ab + b^2`: `x^2 + 2 · 3 · x + 9 = x^2 + 6x + 9`."),
    (C + "esitsizlik", 0.5, "`-2x + 1 > 7` eşitsizliğinin çözüm kümesi hangisidir?",
     [("A", "`x < -3`", None), ("B", "`x > -3`", "esitsizlik.negatifle-carpma-yon"),
      ("C", "`x < -4`", "denklem.taraf-degistirme-isaret"), ("D", "`x > 3`", None)], "A", "(7 - 1)/(-2)", "-3",
     "`-2x > 6`; negatifle bölünce yön değişir: `x < -3`."),
    (C + "mutlak-deger", 0.5, "`|x - 2| = 5` denkleminin çözüm kümesi hangisidir?",
     [("A", "`{7}`", "mutlak.tek-durum"), ("B", "`{-7, 7}`", "sayilar.parantez-eksi-dagitma"), ("C", "`{-3, 7}`", None),
      ("D", "`{-7, 3}`", None)], "C", "FiniteSet(2 - 5, 2 + 5)", "{-3, 7}",
     "İki durum: `x - 2 = 5` ise `x = 7`; `x - 2 = -5` ise `x = -3`."),
    (C + "oran-oranti", 0.5, "4 işçi bir duvarı 6 günde örüyor. Aynı hızla çalışan 8 işçi bu duvarı kaç günde örer?",
     [("A", "`12`", "oran.ters-oran-dogru-gibi"), ("B", "`24`", "genel.soruyu-yarim-okuma"), ("C", "`2`", None),
      ("D", "`3`", None)], "D", "4*6/8", "3", "İşçi sayısı artınca süre azalır (ters orantı): `4 · 6 = 8 · t`, `t = 3`."),
    (R + "sayi", 0.5, "Bir sayının 3 katının 5 fazlası 26'dır. Bu sayı kaçtır?",
     [("A", "`7`", None), ("B", "`21`", "genel.soruyu-yarim-okuma"), ("C", "`31/3`", "denklem.taraf-degistirme-isaret"),
      ("D", "`8`", None)], "A", "(26 - 5)/3", "7", "`3x + 5 = 26`; `3x = 21`; `x = 7`."),
    (R + "kesir", 0.5,
     "Bir öğrenci kitabının önce `1/3`'ünü, sonra kalanın `1/2`'sini okuyor. Kitabın kaçta kaçı okunmadan kalmıştır?",
     [("A", "`1/6`", "kesir.kalan-butun-karistirma"), ("B", "`1/3`", None), ("C", "`2/3`", None),
      ("D", "`3/5`", "rasyonel.pay-payda-ayri-toplama")], "B", "(1 - Rational(1,3))*Rational(1,2)", "1/3",
     "Kalan `2/3`; bunun yarısı okunur, geriye `2/3 · 1/2 = 1/3` kalır."),
    (R + "yuzde", 0.5, "Fiyatı 200 TL olan bir ürüne önce %20, sonra %10 zam yapılıyor. Ürünün son fiyatı kaç TL'dir?",
     [("A", "`260`", "yuzde.ardisik-toplama"), ("B", "`240`", "genel.soruyu-yarim-okuma"), ("C", "`264`", None),
      ("D", "`280`", None)], "C", "200*Rational(12,10)*Rational(11,10)", "264",
     "Sırayla uygula: `200 · 1,2 = 240`; `240 · 1,1 = 264`."),
    (R + "hareket", 0.5, "Saatte 60 km hızla giden bir araç 45 dakikada kaç km yol alır?",
     [("A", "`2700`", "hareket.birim-donusumu"), ("B", "`45`", None), ("C", "`80`", "oran.ters-oran-dogru-gibi"),
      ("D", "`40`", None)], "B", "60*Rational(45,60)", "45", "45 dakika `3/4` saattir: `60 · 3/4 = 45` km."),
]

# --- Şablon soruları (§10.4; source='template', sıfır LLM) -------------------------------------------------
# (code, template_id, skill, stem, options, correct, expr, value, solution, figure: None | (alt_text, review_status), status)
TPL: list[tuple[str, str, str, str, list[tuple[str, str, str | None]], str, str, str, str,
                tuple[str, str] | None, str]] = [
    ("T01", "islem-onceligi", D + "sayilar", "`8 - 2 · (-3)` işleminin sonucu kaçtır?",
     [("A", "`-18`", "sayilar.islem-onceligi-soldan"), ("B", "`2`", "sayilar.negatif-carpim-isaret"), ("C", "`14`", None),
      ("D", "`12`", None)], "C", "8 - 2*(-3)", "14", "Önce çarpma: `2 · (-3) = -6`; `8 - (-6) = 14`.", None, "approved"),
    ("T02", "islem-onceligi", D + "sayilar", "`-(5 - 9) · 2` işleminin sonucu kaçtır?",
     [("A", "`8`", None), ("B", "`-28`", "sayilar.parantez-eksi-dagitma"), ("C", "`-8`", "sayilar.negatif-carpim-isaret"),
      ("D", "`4`", None)], "A", "-(5 - 9)*2", "8", "`5 - 9 = -4`; `-(-4) = 4`; `4 · 2 = 8`.", None, "approved"),
    ("T03", "uslu-sadelestirme", D + "uslu", "`3^4 · 3^(-2)` ifadesinin değeri kaçtır?",
     [("A", "`1/6561`", "uslu.usleri-carpma"), ("B", "`-729`", "uslu.negatif-us-isaret"), ("C", "`27`", None),
      ("D", "`9`", None)], "D", "3**4 * 3**(-2)", "9", "Üsler toplanır: `3^(4 - 2) = 3^2 = 9`.", None, "approved"),
    ("T04", "uslu-sadelestirme", D + "uslu", "`2^5 / 2^2` ifadesinin değeri kaçtır?",
     [("A", "`8`", None), ("B", "`1024`", "uslu.usleri-carpma"), ("C", "`-8`", "uslu.negatif-us-isaret"),
      ("D", "`16`", None)], "A", "2**5 / 2**2", "8", "Bölmede üsler çıkarılır: `2^(5 - 2) = 2^3 = 8`.", None, "approved"),
    ("T05", "denklem-birinci-derece", C + "denklem", "`(x + 1)/3 = x - 3` denkleminin çözümü kaçtır?",
     [("A", "`2`", "denklem.paydayla-carpma-eksik"), ("B", "`5`", None), ("C", "`-5/2`", "denklem.taraf-degistirme-isaret"),
      ("D", "`4`", None)], "B", "Rational(10,2)", "5",
     "Her terimi 3 ile çarp: `x + 1 = 3x - 9`; `10 = 2x`; `x = 5`.", None, "approved"),
    ("T06", "denklem-birinci-derece", C + "denklem", "`4x - 7 = x + 8` denkleminin çözümü kaçtır?",
     [("A", "`1/3`", "denklem.taraf-degistirme-isaret"), ("B", "`15`", "genel.soruyu-yarim-okuma"), ("C", "`3`", None),
      ("D", "`5`", None)], "D", "(8 + 7)/3", "5", "`4x - x = 8 + 7`; `3x = 15`; `x = 5`.", None, "approved"),
    ("T07", "kesir-modeli-toplama", D + "rasyonel-sayilar",
     "Şekilde iki kesir modeli var: ilki 4 eş parçadan 1'i, ikincisi 2 eş parçadan 1'i boyalı. `1/4 + 1/2` toplamı kaçtır?",
     [("A", "`2/6`", "rasyonel.pay-payda-ayri-toplama"), ("B", "`2/4`", "rasyonel.payda-esitlemeden-toplama"),
      ("C", "`3/4`", None), ("D", "`1/8`", None)], "C", "Rational(1,4)+Rational(1,2)", "3/4",
     "Paydaları 4'te eşitle: `1/4 + 2/4 = 3/4`.",
     ("Solda 4 eş parçaya bölünmüş, 1 parçası boyalı bir dikdörtgen; sağda 2 eş parçaya bölünmüş, 1 parçası boyalı bir dikdörtgen.",
      "verified"), "approved"),
    ("T08", "kesir-modeli-toplama", D + "rasyonel-sayilar",
     "Şekilde 3 ve 6 eş parçaya bölünmüş iki dikdörtgen var. `2/3 + 1/6` toplamı kaçtır?",
     [("A", "`3/9`", "rasyonel.pay-payda-ayri-toplama"), ("B", "`5/6`", None),
      ("C", "`3/6`", "rasyonel.payda-esitlemeden-toplama"), ("D", "`4/6`", None)], "B", "Rational(2,3)+Rational(1,6)",
     "5/6", "Paydaları 6'da eşitle: `4/6 + 1/6 = 5/6`.",
     ("Solda 3 eş parçaya bölünmüş, 2 parçası boyalı; sağda 6 eş parçaya bölünmüş, 1 parçası boyalı iki dikdörtgen.",
      "verified"), "approved"),
    ("T09", "sayi-dogrusu-esitsizlik", C + "mutlak-deger",
     "Şekildeki sayı doğrusunda taralı aralık `|x - 1| < 3` eşitsizliğini gösteriyor. Çözüm aralığı hangisidir?",
     [("A", "`x < 4`", "mutlak.tek-durum"), ("B", "`(-4, 2)`", "esitsizlik.negatifle-carpma-yon"), ("C", "`(-2, 4)`", None),
      ("D", "`(-2, 3)`", None)], "C", "Interval.open(1 - 3, 1 + 3)", "(-2, 4)",
     "İki durum: `-3 < x - 1 < 3`; her tarafa 1 ekle: `-2 < x < 4`.",
     ("-5 ile 5 arasında bir sayı doğrusu; -2 ve 4 noktalarında boş daire, aralarındaki bölge taralı.", "verified"),
     "approved"),
    ("T10", "sayi-dogrusu-esitsizlik", C + "esitsizlik",
     "`-3x ≥ 6` eşitsizliğinin çözümü şekildeki sayı doğrusunda gösterilmiştir. Çözüm hangisidir?",
     [("A", "`x ≥ -2`", "esitsizlik.negatifle-carpma-yon"), ("B", "`x ≤ 2`", "denklem.taraf-degistirme-isaret"),
      ("C", "`x ≥ 2`", None), ("D", "`x ≤ -2`", None)], "D", "6/(-3)", "-2",
     "Negatifle bölünce yön değişir: `x ≤ 6/(-3) = -2`.",
     ("-5 ile 5 arasında bir sayı doğrusu; -2 noktasında dolu daire ve soldaki bölge taralı.", "verified"), "approved"),
    ("T11", "yuzde-grafik", R + "yuzde",
     "Şekildeki çubuk grafikte 100 TL'lik ürünün fiyatı önce %10, sonra %20 zamla gösteriliyor. Son fiyat kaç TL'dir?",
     [("A", "`130`", "yuzde.ardisik-toplama"), ("B", "`132`", None), ("C", "`125`", "yuzde.kar-satis-uzerinden"),
      ("D", "`110`", None)], "B", "100*Rational(11,10)*Rational(12,10)", "132",
     "Sırayla uygula: `100 · 1,1 = 110`; `110 · 1,2 = 132`.",
     ("Üç çubuklu grafik: başlangıç 100 TL, ilk zamdan sonra 110 TL, ikinci zamdan sonra 132 TL.", "verified"),
     "approved"),
    ("T12", "yuzde-grafik", R + "yuzde",
     "Şekildeki grafikte maliyeti 80 TL olan ürünün satış fiyatı 100 TL. Kâr yüzdesi kaçtır?",
     [("A", "`%20`", "yuzde.kar-satis-uzerinden"), ("B", "`20 TL`", "genel.soruyu-yarim-okuma"), ("C", "`%30`", None),
      ("D", "`%25`", None)], "D", "(100 - 80)*100/80", "25", "Kâr maliyet üzerinden: `20/80 = 1/4`, yani `%25`.",
     ("İki çubuklu grafik: maliyet 80 TL, satış fiyatı 100 TL.", "pending"), "pending_review"),
]


def content_hash(stem: str, options: list[dict[str, Any]] | None) -> str:
    norm = " ".join(stem.split()).lower() + "|" + "|".join(
        f"{o['key']}:{' '.join(o['text'].split()).lower()}" for o in (options or []))
    return sha256_hex(norm)


def _opts(rows: list[tuple[str, str, str | None]]) -> list[dict[str, Any]]:
    return [{"key": k, "text": t, "misconception_tag": g} for k, t, g in rows]


def diagnostic_questions() -> tuple[list[dict], list[dict]]:
    qs, keys = [], []
    for i, (skill, diff, stem, opts, correct, expr, val, sol) in enumerate(DIAG, start=1):
        code = f"DIAG-2026.1-{i:02d}"
        qid = uid("question", code)
        options = _opts(opts)
        qs.append({
            "id": qid, "code": code, "curriculum_id": CURRICULUM_ID, "skill_ids": [sk(skill)], "kind": "mcq", "stem": stem,
            "stem_values": {}, "figure_id": None, "options": options, "difficulty": diff, "source": "diagnostic",
            "template_id": None, "template_params": None, "content_hash": content_hash(stem, options),
            "verification": {"schema": True, "sympy": "verified", "render": "not_applicable", "vision": "not_applicable",
                             "attempts": 0},
            "status": "approved", "model": None, "cost_usd": 0, "prompt_version": None,
            "reviewed_by": uid("staff", "coord"), "reviewed_at": "2026-10-01T09:00:00Z", "review_note": "seed",
            "created_at": "2026-10-01T09:00:00Z",
        })
        keys.append({"question_id": qid, "correct_option": correct, "numeric_value": val, "numeric_tolerance": 0,
                     "canonical_expr": expr, "solution": sol, "sympy_status": "verified",
                     "sympy_report": {"expr": expr, "value": val, "matched_option": correct},
                     "written_by": "seed", "verified_at": "2026-10-01T09:00:00Z", "created_at": "2026-10-01T09:00:00Z"})
    return qs, keys


def template_questions() -> tuple[list[dict], list[dict], list[dict], list[dict]]:
    qs, keys, figs, tpls = [], [], [], {}
    for code, tid, skill, stem, opts, correct, expr, val, sol, fig, status in TPL:
        qid = uid("question", code)
        options = _opts(opts)
        fig_id = None
        if fig is not None:
            fig_id = uid("figure", code)
            fcode = f"# şablon: {tid}\n# seed=7 varyant={code}\n"
            figs.append({
                "id": fig_id, "tool": "template", "code": fcode, "code_hash": sha256_hex(fcode), "alt_text": fig[0],
                "png_path": f"figures/{fig_id}.png", "svg_path": None, "width_px": 800, "height_px": 400,
                "bytes": 41250, "render_status": "rendered", "vision_status": "not_applicable", "vision_report": None,
                "attempts": 0, "review_status": fig[1],
                "reviewed_by": None, "reviewed_at": "2026-10-05T03:20:00Z" if fig[1] == "verified" else None,
                "render_log": None, "created_at": "2026-10-05T03:20:00Z",
            })
        approved = status == "approved"
        qs.append({
            "id": qid, "code": code, "curriculum_id": CURRICULUM_ID, "skill_ids": [sk(skill)], "kind": "mcq", "stem": stem,
            "stem_values": {}, "figure_id": fig_id, "options": options, "difficulty": 0.5, "source": "template",
            "template_id": tid, "template_params": {"seed": 7, "variant": code},
            "content_hash": content_hash(stem, options),
            "verification": {"schema": True, "sympy": "verified", "render": "ok" if fig else "not_applicable",
                             "vision": "not_applicable", "attempts": 0},
            "status": status, "model": None, "cost_usd": 0, "prompt_version": None, "reviewed_by": None,
            "reviewed_at": "2026-10-05T03:20:00Z" if approved else None,
            "review_note": "şablon: otomatik onay" if approved else "Şekil incelemesi bekliyor",
            "created_at": "2026-10-05T03:20:00Z",
        })
        keys.append({"question_id": qid, "correct_option": correct, "numeric_value": val, "numeric_tolerance": 0,
                     "canonical_expr": expr, "solution": sol, "sympy_status": "verified",
                     "sympy_report": {"expr": expr, "value": val, "matched_option": correct},
                     "written_by": "batch_worker:template", "verified_at": "2026-10-05T03:20:00Z",
                     "created_at": "2026-10-05T03:20:00Z"})
        if tid not in tpls:
            tpls[tid] = {"id": tid, "curriculum_id": CURRICULUM_ID, "skill_id": sk(skill),
                         "module_path": f"content/tyt-matematik/templates/{tid.replace('-', '_')}.py:generate",
                         "engine": "matplotlib" if fig else "sympy",
                         "params_schema": {"$ref": "https://ogrenmen.easy/schemas/template-params.json"},
                         "enabled": True, "has_figure": fig is not None, "created_at": "2026-10-05T00:00:00Z"}
    return qs, keys, figs, list(tpls.values())


def llm_questions() -> tuple[list[dict], list[dict]]:
    """1 onaylı LLM sorusu (öğrenciye pratikte GİTMEZ) + 2 onay bekleyen (kuyruk)."""
    rows = [
        ("L01", D + "rasyonel-sayilar", "`5/6 - 1/4` işleminin sonucu kaçtır?",
         [("A", "`4/2`", "rasyonel.pay-payda-ayri-toplama"), ("B", "`7/12`", None),
          ("C", "`4/6`", "rasyonel.payda-esitlemeden-toplama"), ("D", "`1/12`", None)], "B",
         "Rational(5,6)-Rational(1,4)", "7/12", "Paydaları 12'de eşitle: `10/12 - 3/12 = 7/12`.", "approved", "verified"),
        ("L02", C + "oran-oranti", "Bir tarifte 3 yumurtaya 2 su bardağı un gidiyor. 9 yumurta için kaç bardak un gerekir?",
         [("A", "`6`", None), ("B", "`3`", "oran.ters-oran-dogru-gibi"), ("C", "`8`", None),
          ("D", "`18`", "genel.soruyu-yarim-okuma")], "A", "Rational(2,3)*9", "6",
         "Doğru orantı: `3/2 = 9/x`, `x = 6`.", "pending_review", "verified"),
        ("L03", R + "yas", "Annenin yaşı kızının yaşının 3 katıdır. Hangi ifade bu ilişkiyi doğru anlatır?",
         [("A", "Anne kızından 3 yaş büyüktür.", "genel.soruyu-yarim-okuma"), ("B", "Kızın yaşı annenin üçte biridir.", None),
          ("C", "Kızın yaşı annenin 3 katıdır.", "oran.ters-oran-dogru-gibi"), ("D", "İkisinin yaşları toplamı 3'tür.", None)],
         "B", "", "", "Annenin yaşı `3k` ise kızınki `k`; yani kızın yaşı annenin üçte biridir.", "pending_review",
         "not_applicable"),
    ]
    qs, keys = [], []
    for code, skill, stem, opts, correct, expr, val, sol, status, sym in rows:
        qid = uid("question", code)
        options = _opts(opts)
        qs.append({
            "id": qid, "code": code, "curriculum_id": CURRICULUM_ID, "skill_ids": [sk(skill)], "kind": "mcq", "stem": stem,
            "stem_values": {}, "figure_id": None, "options": options, "difficulty": 0.5, "source": "llm",
            "template_id": None, "template_params": None, "content_hash": content_hash(stem, options),
            "verification": {"schema": True, "sympy": sym, "render": "not_applicable", "vision": "not_applicable",
                             "attempts": 1},
            "status": status, "model": "gemini-2.5-flash-lite", "cost_usd": 0.00031, "prompt_version": "question_gen.v1",
            "reviewed_by": uid("staff", "inst") if status == "approved" else None,
            "reviewed_at": "2026-10-12T10:00:00Z" if status == "approved" else None,
            "review_note": None, "created_at": "2026-10-11T00:40:00Z",
        })
        key = {"question_id": qid, "correct_option": correct, "numeric_tolerance": 0, "solution": sol,
               "sympy_status": sym, "written_by": "batch_worker:tablet" if sym == "verified" else "batch_worker:unverified",
               "verified_at": "2026-10-11T00:41:00Z" if sym == "verified" else None, "created_at": "2026-10-11T00:41:00Z"}
        if expr:
            key.update({"canonical_expr": expr, "numeric_value": val,
                        "sympy_report": {"expr": expr, "value": val, "matched_option": correct}})
        else:
            key.update({"canonical_expr": None, "numeric_value": None, "sympy_report": {"note": "sözel madde"}})
        keys.append(key)
    return qs, keys


def question_item(q: dict[str, Any]) -> dict[str, Any]:
    """questions satırını question-item sözleşmesine çevirir (cevap anahtarı yok)."""
    item: dict[str, Any] = {
        "schema_version": "1.0", "id": q["id"], "curriculum_code": CURRICULUM_CODE, "kind": q["kind"],
        "skill_ids": q["skill_ids"], "stem": q["stem"], "stem_values": q["stem_values"], "figure": None,
        "options": q["options"], "difficulty": q["difficulty"], "source": q["source"],
        "verification": {**q["verification"], "status": q["status"], "review_note": q["review_note"]},
    }
    return item
