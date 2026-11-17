# packages/pii — PII temizleyici (M01)

LLM'e gidecek her metin bu temizleyiciden geçer (`docs/BLUEPRINT.md` §2.3, §9.1). TypeScript (`ts/`,
paket adı `@ogrenmen/pii`, Worker kullanır) ve Python (`py/`, paket adı `ogrenmen_pii`, pipelines kullanır)
uygulamaları **aynı** `cases.json` vakalarını birebir aynı çıktıyla geçer; `dump` çıktıları CI'da `diff`'lenir.
Kurallar deterministiktir, LLM çağrılmaz, ağ yoktur.

## Arayüz

```ts
import { scrub, nameTokenHashes } from '@ogrenmen/pii';
scrub(text, { nameHashes: string[], roleHashes?: { [hash]: 'ÖĞRENCİ' | 'EĞİTMEN' | 'VELİ' } })
  // → { text, replacements: [{ kind, count }] }   (yalnız count > 0 olan türler, sabit sırada)
```

```python
from ogrenmen_pii import scrub, name_token_hashes, total_replacements
scrub(text, {"nameHashes": [...], "roleHashes": {...}})   # ya da scrub(text, name_hashes=[...], role_hashes={...})
```

Düz ad listesi **asla** girdi değildir. Adlar ad-token hash'leriyle gelir; türetim (üç dilde aynı):

1. metin NFC'ye çevrilir;
2. token = `[harf]+('[küçük harf]+)?` (`token` deseni; `Ayşe-Nur` iki tokendır), kesme işaretli ek (`'in`, `’e`) atılır;
3. 3+ karakterli tokenlar alınır;
4. **katlama**: `İ`, `I` ve `ı` → `i`; diğer büyük harfler Türkçe küçük karşılığına
   (`FOLD_FROM = 'ABCÇDEFGĞHIİıJKLMNOÖPQRSŞTUÜVWXYZÂÎÛ'` → `FOLD_TO = 'abcçdefgğhiiijklmnoöpqrsştuüvwxyzâîû'`) —
   böylece `ELIF`, `ELİF`, `Elif`, `elıf` aynı hash'i verir;
5. `sha256(UTF-8)` hex; ilk görülme sırası korunur, tekrar yok.

`nameTokenHashes(fullName)` / `name_token_hashes(full_name)` bunu üretir; SQL eşleniği
`sql/name_token_hashes.sql` (`app.pii_name_token_hashes(text)`, aşağıdaki M02 notu). `bot_responses.pii_replacements`
için `totalReplacements` / `total_replacements`.

Hatalı girdi sessizce geçmez (PII kapısı kapalı kalır): `nameHashes` dizi değilse (tek dizge, `null`, nesne, eksik)
`OGR-SCR-001`; bir hash 64 haneli hex değilse (düz ad, kısa hex) `OGR-SCR-002`; rol etiketi `ÖĞRENCİ`/`EĞİTMEN`/`VELİ`
dışındaysa (`toString`, `ÖĞRENCI` dahil) `OGR-SCR-003`; metin dizge değilse `OGR-SCR-004`. Python'da
`scrub(text, [hashler])` ve `scrub(text, name_hashes=[...])` biçimleri de aynı denetimden geçer; `scrub(text)`
(hash listesi yok) `OGR-SCR-001` verir — hiç ad yoksa boş liste verilir.

## Kurallar (sırayla uygulanır)

| # | Tür (`kind`) | Yer tutucu | Kapsam |
| --- | --- | --- | --- |
| 1 | `url` | `[URL]` | `https://`, `http://`, `www.`, `t.me/` |
| 2 | `email` | `[E-POSTA]` | |
| 3 | `iban` | `[IBAN]` | `TR` + 24 hane (dörtlü boşluklu yazım dahil) |
| 4 | `tckn` | `[TCKN]` | 11 hane + T.C. kimlik kontrol haneleri; geçersiz sayı dokunulmaz |
| 5 | `phone` | `[TELEFON]` | TR cep: `(+90\|0)? 5xx xxx xx xx` (boşluk, tire, parantez); sabit hat dokunulmaz |
| 6 | `username` | `[KULLANICI]` | `@kullanici`; `@hoca` yönlendirme anahtarı korunur |
| 7 | `student` / `instructor` / `guardian` / `name` | `[ÖĞRENCİ]` / `[EĞİTMEN]` / `[VELİ]` / `[AD]` | ad-token hash eşleşmesi (rol `roleHashes`'ten, yoksa `[AD]`) |
| 8 | `intro_name` | `adım [AD]` | "adım X", "benim adım X", "ismim X" |
| 9 | `honorific_name` | `[AD] Hoca` | "X Hoca/Bey/Hanım/Öğretmen" (branş adları hariç) |
| 10 | `school` | `[OKUL]` | "… Anadolu Lisesi", "… Koleji", "… Okulu", "… Ortaokulu", "… Fen Lisesi", üniversite, dershane |
| 11 | `class_section` | `[SINIF]` | "11-C", "9/A", "12 - B"; yalnız lise sınıfları 9–12; soru/şık atfı hariç (aşağıda) |

Matematik ifadeleri (`3/4`, `x^2`, `√5`, `%20`, `2*sqrt(3)`, `0,75`) ve kazanım adları dokunulmaz; bilinmeyen özel
adlar (Pisagor, Öklid) kaldırılmaz — yanlış pozitif terimleri bozardı, bu yüzden hash listesi zorunlu girdidir.
`class_section` 4 seçenekli soru atıflarını bozmaz: aday, önünde `soru`/`cevap`/`cevab`/`şık`/`seçene`/`yanıt`/`madde`
(çekimli biçimler dahil; `class_prev`) ya da ardında aynı sözcükler, `doğru`/`yanlış` veya virgüllü bir `N-X` çifti
(`class_next`) varsa dokunulmaz: "Soru 10-A şıkkı", "Cevap: 9-B, 10-C, 11-D", "Cevabım 12/B", "11-C doğru mu?",
"12-A seçeneğini" aynen kalır. Bedeli: virgülle sıralanmış şube listesi ("9-B, 10-C sınıfları") ve ortaokul
şubeleri ("7-B") temizlenmez. Kesme işaretsiz Türkçe ekler (`Elifle`) yakalanmaz (§12 #10); ikinci kemer `[AD]` kalıpları ve prompt'taki
"ad sorma" kuralıdır. Düzenli ifadeler modül yüklenirken bir kez derlenir (Worker CPU bütçesi).

## Vaka dosyası

`cases.json`: 123 vaka + 15 hash vakası + 18 hata vakası (her `kind` ve her `OGR-SCR-00x` en az bir vakada;
matematik, kazanım adı, soru/şık atfı, `ELIF`/`IŞIL`/`Ilayda`/`Irmak Işık`, NFD yazım, idempotans, emoji, enjeksiyon
ve birleşik metinler dahil). `error_cases` iki dilde aynı hata kodunu sınar; dump'a `{id, error}` olarak yazılır. Beklenen çıktılar `scripts/gen_cases.py` içinde **elle** yazılır; betik
yalnız adları hash'e çevirir (temizleyiciden bağımsız `hashlib` ile):

```
python /home/user/alperen/packages/pii/scripts/gen_cases.py          # cases.json'u yazar
python /home/user/alperen/packages/pii/scripts/gen_cases.py --check  # güncel değilse 1
```

## Kurulum ve test

```
bun install --cwd /home/user/alperen/packages/pii/ts && bun run --cwd /home/user/alperen/packages/pii/ts typecheck && bun run --cwd /home/user/alperen/packages/pii/ts test
python -m pip install -e /home/user/alperen/packages/pii/py[dev] && python -m pytest /home/user/alperen/packages/pii/py -q
bun run --cwd /home/user/alperen/packages/pii/ts dump > /tmp/pii-ts.json && python -m ogrenmen_pii.dump > /tmp/pii-py.json && diff /tmp/pii-ts.json /tmp/pii-py.json
```

`dump`, vakaların o anki gerçek çıktısını, hata vakalarının kodunu ve kural yapılandırmasını (desen dizgeleri,
kelime listeleri, katlama tablosu, hata kodları) yazar;
iki dil arasındaki her sapma `diff`'te görünür. Vaka dosyası yolu `--cases <yol>` ya da `OGRENMEN_PII_CASES` ile
değiştirilebilir.

Python testleri ayrıca `sql/name_token_hashes.sql` bloğunu yerel Postgres'te (`pg_temp` şemasında, kalıcı nesne
bırakmadan) çalıştırıp `hash_cases` ile bayt eşitliğini denetler; `psql` yoksa ya da veritabanına
(`OGRENMEN_PII_PG_URL`, varsayılan yerel geliştirme adresi) bağlanılamıyorsa bu test atlanır — ağ gerekmez.

## TypeScript tüketicileri

`src/` ham TypeScript olarak dışa açılır; iç içe aktarımlar `.js` uzantılıdır (`./scrub.js` → `scrub.ts`). Bu
yüzden tüketicinin `allowImportingTsExtensions` bayrağına ihtiyacı yoktur; `moduleResolution: "Bundler"` ve
`"NodeNext"` ikisi de çalışır (Worker M04, panel M11 `file:` bağıyla kullanır). `lib` en az `ES2022` olmalıdır
(`Object.hasOwn`, `String.prototype.normalize`).

## Sapma / M02 notu

Blueprint'ten bilinçli üç sapma; M02 ve tüketiciler bunlara göre yazar:

1. **Ad-token katlaması `lower()` değildir.** §3.0 (`app.refresh_name_hashes`, `app.staff_name_hashes`) ve §3.1
   (`sha256(lower(token))`) düz `lower()` der; bu, temizleyiciyle **eşleşmez**: `lower('Işıl')` = `'işıl'`,
   `lower('IŞIL')` = `'işil'`, ICU collation'da `lower('İ')` = `'i' + U+0307`. Böylece Irmak, Işıl, Ilgın, Ilayda gibi
   adlar `name_token_hashes` ile hiç eşleşmez ve LLM'e temizlenmeden giderdi. Tek doğru türetim yukarıdaki 5 adımdır.
   M02 `sql/name_token_hashes.sql` içindeki `-- begin pii` … `-- end pii` bloğunu 0003 migration'ına birebir kopyalar
   ve iki tetikleyici/fonksiyon tokenları bununla türetir:

   ```sql
   new.name_token_hashes := app.pii_name_token_hashes(concat_ws(' ', new.display_name, new.guardian_name));
   -- app.staff_name_hashes(p_chat): select … app.pii_name_token_hashes(s.full_name) …
   ```

   Fonksiyonun çekirdeği (tek token için):

   ```sql
   encode(sha256(convert_to(translate(tok, 'ABCÇDEFGĞHIİıJKLMNOÖPQRSŞTUÜVWXYZÂÎÛ',
                                           'abcçdefgğhiiijklmnoöpqrsştuüvwxyzâîû'), 'UTF8')), 'hex')
   ```

   `tok`, `normalize(ad, NFC)` üzerinde temizleyicinin `token` deseniyle (`regexp_matches(…, 'g')`) alınır, kesme
   işaretli ek atılır, 3+ karakter. Boşluğa göre bölme (`string_to_array`) da yanlıştır: `Ayşe-Nur` iki tokendır.
   M02 `01_schema.sql` bu fonksiyonu `cases.json` `hash_cases` ile (ör. `hc-irmak-isik`, `hc-irem-caps`,
   `hc-hyphen`, `hc-dotted-dotless`) bayt eşitliğiyle sınayabilir. ASCII katlama (ş→s, ü→u) **yapılmaz**: §3.1 tokenı
   "unaccent-siz" tanımlar ve `Şen` ↔ `sen` gibi çakışmalar her mesajda yanlış pozitif üretirdi; `Sukru` yazımı
   `Şükrü` hash'iyle eşleşmez (vaka `hash-ascii-fold-not-applied`, bilinen sınır).
2. **Hata kodları `OGR-SCR-00x`.** `OGR-PII-001` §3.9'da `update_student_pii` "alan izinli değil" anlamına aittir;
   temizleyici onu kullanmaz. Yeni aile: `OGR-SCR-001` seçenek yapısı, `OGR-SCR-002` hash biçimi (düz ad değil hash
   bekleniyor), `OGR-SCR-003` rol etiketi, `OGR-SCR-004` metin tipi. Mesajın ilk 11 karakteri koddur.
3. **`class_section` daraltıldı.** §2.3 yalnız "11-C", "9/A" örneklerini verir; soru/şık atıflarını (`5-A şıkkı`)
   bozmamak için sınıf 9–12 ile sınırlı ve soru/şık bağlamında uygulanmaz (yukarıda).
