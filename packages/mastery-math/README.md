# @ogrenmen/mastery-math — ustalık matematiği (BKT, M00)

Bayesian Knowledge Tracing'in tek kaynağı (BLUEPRINT §2.2, §3.7, ADR-0001). Aynı formül üç dilde
uygulanır ve `fixtures/bkt-vectors.json`'daki 41 vektörde 1e-9 toleransla aynı sonucu verir:

| Dil | Dosya | Adlar | Kim kullanır |
| --- | --- | --- | --- |
| TypeScript | `src/bkt.ts` | `bktStep`, `blendStep`, `inferredGuess`, `observationStep` | Worker (anlık özet, `FakeDb`) |
| Python | `python/ogrenmen_mastery/bkt.py` | `bkt_step`/`bktStep`, `blend_step`/`blendStep`, `inferred_guess`/`inferredGuess`, `observation_step` | ders analizi, toplu işler, `JsonlDb` |
| SQL | `sql/bkt.sql` | `app.bkt_step`, `app.blend_step`, `app.inferred_guess` | `public.apply_observation` — **ustalığı yazan tek yer** |

## Formüller

- **İkili gözlem** (`diagnostic`, `practice`, `test`, `resolution`): doğruysa
  `p_obs = p(1−s) / (p(1−s) + (1−p)g)`, yanlışsa `p_obs = ps / (ps + (1−p)(1−g))`; sonra
  `p_new = p_obs + (1−p_obs)·t`. `g = observations.guess_override ?? skills.p_guess` — sayısal sorularda
  `0.05`, dört şıklı sorularda `0.25`.
- **Sürekli gözlem** (`lesson`, `instructor`): `p_new = p + 0.30·c·(m − p)`, `c` boşsa `0.8`.
- **Çıkarım** (`inferred`): yanlış formülü, `g' = g + (1−g)(1−w)` ile; `evidence_count` artmaz.
- **Sohbet gözlemleri** (`chat_question`, `chat_misconception`): `p` ve `evidence_count` değişmez.
- Sonuç her zaman `[0.01, 0.99]` aralığına kırpılır. Payda sıfırsa TS/Python `OGR-MAST-003` fırlatır,
  SQL `NULL` döner (`mastery.p not null` yazımı düşürür).

## SQL kopyası

M02 `sql/bkt.sql` dosyasını `supabase/migrations/0011_mastery.sql` içine `-- begin bkt` … `-- end bkt`
işaretleri arasına **birebir** kopyalar; M13 `check-all.sh` sapmayı `diff` ile yakalar. Bu yüzden dosyanın
kendisi bu işaretleri taşımaz (test bunu denetler).

## Blueprint sapmaları

- **Payda sıfırken ya da `m` boşken SQL `NULL` döner.** §3.7'deki gövde
  `least(0.99, greatest(0.01, p_obs + (1-p_obs)*t))` biçimindedir; Postgres `greatest`/`least` `NULL`'ı yok
  saydığı için o gövde payda sıfır olduğunda (ör. `p=1, s=0` yanlış gözlem; `p=0, g=0` doğru gözlem) ya da
  `blend_step`'te `m` boşken sessizce **0.01** döner (yerel Postgres 16'da doğrulandı). `sql/bkt.sql` bu
  durumda açıkça `NULL` döner; `apply_observation` içinde `mastery.p` / `mastery_history.p_after`
  `not null` kısıtı yazımı düşürür. Gerekçe: TS ve Python aynı girdide `OGR-MAST-003` fırlatır; SQL'in
  sessizce ustalığı 0.01'e çekmesi üç dil arasında karar farkı ve görünmez veri bozulması olurdu.
  Normal girdilerde (DB kısıtlarının izin verdiği `0 < g, s < 1`) sonuç §3.7 gövdesiyle bayt bayt aynıdır
  (41 vektör).
- **M02 için:** `supabase/migrations/0011_mastery.sql` içindeki `-- begin bkt` … `-- end bkt` bloğuna
  BLUEPRINT §3.7'deki metin değil **bu dosya** (`sql/bkt.sql`) birebir kopyalanır; M13 `check-all.sh` `diff`'i
  bu dosyaya karşı yapar.

## Komutlar

```
bun install --cwd /home/user/alperen/packages/mastery-math && bun test --cwd /home/user/alperen/packages/mastery-math
python -m pip install -e /home/user/alperen/packages/mastery-math/python[dev] && python -m pytest /home/user/alperen/packages/mastery-math/python -q
```

`OGRENMEN_DATABASE_URL` tanımlıysa (ve `psql` kuruluysa) Python testi `bkt.sql`'i geri alınan bir işlemde
yükleyip 41 vektörü SQL'de de hesaplar; tanımlı değilse bu tek test `SKIP` olur. Referans değerler ayrıca
kesirli (tam) aritmetikle bağımsız olarak doğrulanmıştır.
