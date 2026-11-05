-- packages/pii/sql/name_token_hashes.sql — ad-token hash türetiminin SQL eşleniği (M01 → M02 sözleşmesi)
--
-- Bu fonksiyon packages/pii'deki `nameTokenHashes` (TS) ve `name_token_hashes` (Python) ile bayt düzeyinde
-- aynı hash listesini üretir. M02 bu bloğu `-- begin pii` … `-- end pii` işaretleri arasıyla birlikte
-- 0003 migration'ına BİREBİR kopyalar; `app.refresh_name_hashes()` (display_name, guardian_name) ve
-- `app.staff_name_hashes(p_chat)` (staff.full_name) tokenları bununla türetir:
--
--   new.name_token_hashes := app.pii_name_token_hashes(concat_ws(' ', new.display_name, new.guardian_name));
--
-- Blueprint §3.0/§3.1'deki düz `lower()` KULLANILMAZ: `lower('Işıl')` = 'işıl' ama temizleyici 'işil' hash'ler;
-- ICU collation'da `lower('İ')` = 'i' + U+0307 olur. Katlama yerelden bağımsız `translate` ile yapılır:
--   1. normalize(…, NFC)
--   2. token = [harf]+ ('[küçük harf]+)? — temizleyicinin `token` deseni; kesme işaretli ek atılır
--   3. 3+ karakterli tokenlar
--   4. translate: İ, I, ı → i; diğer büyük harfler Türkçe küçük karşılığına (FOLD_FROM → FOLD_TO)
--   5. sha256(UTF-8) hex; ilk görülme sırası korunur, tekrar yok
-- Sözleşme vakaları: packages/pii/cases.json `hash_cases` (01_schema.sql bunlarla bayt eşitliği denetleyebilir).
-- Sunucu kodlaması UTF8 olmalıdır (normalize() bunu ister).

-- begin pii
create or replace function app.pii_name_token_hashes(p_name text) returns text[]
language sql immutable strict parallel safe
set search_path = pg_catalog
as $$
  select coalesce(array_agg(t.h order by t.first_ord), '{}'::text[])
    from (
      select encode(sha256(convert_to(
               translate(b.base,
                         'ABCÇDEFGĞHIİıJKLMNOÖPQRSŞTUÜVWXYZÂÎÛ',
                         'abcçdefgğhiiijklmnoöpqrsştuüvwxyzâîû'),
               'UTF8')), 'hex') as h,
             min(b.ord) as first_ord
        from (
          select regexp_replace(m.tok[1], '[''’].*$', '') as base, m.ord
            from regexp_matches(
                   normalize(p_name, NFC),
                   '(?<![A-ZÇĞİÖŞÜÂÎÛa-zçğıöşüâîû\[])[A-ZÇĞİÖŞÜÂÎÛa-zçğıöşüâîû]+(?:[''’][a-zçğıöşüâîû]+)?',
                   'g') with ordinality as m(tok, ord)
        ) b
       where char_length(b.base) >= 3
       group by 1
    ) t
$$;
-- end pii
