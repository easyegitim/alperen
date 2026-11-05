-- SPEC 16.4: RLS kapalı public tablo olmamalı. Çıktı boş olmalı.
select tablename from pg_tables where schemaname = 'public' and not rowsecurity order by 1;
