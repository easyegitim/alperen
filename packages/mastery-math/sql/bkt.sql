-- Öğrenmen ustalık matematiği (BKT) — tek kaynak: packages/mastery-math.
-- Bu dosya supabase/migrations/0011_mastery.sql içine, "begin bkt" ve
-- "end bkt" yorum işaretleri arasına birebir kopyalanır; sapma CI'da yakalanır.
-- TS (src/bkt.ts) ve Python (ogrenmen_mastery/bkt.py) aynı formülü uygular;
-- fixtures/bkt-vectors.json üç dilde 1e-9 toleransla aynı sonucu verir.

-- İkili gözlem adımı: doğru/yanlış gözlemden sonra bilme olasılığı.
-- p: önsel, g: bilmeden doğru (guess), s: bilip yanlış (slip),
-- t: fırsat başına öğrenme (learn). Sonuç [0.01, 0.99] aralığına kırpılır.
-- Payda sıfırsa NULL döner (greatest/least NULL'ı yok saydığı için açıkça
-- denetlenir); apply_observation'da mastery.p not null kısıtı yazımı düşürür.
create or replace function app.bkt_step(
    p numeric, correct boolean, g numeric, s numeric, t numeric
)
returns numeric
language sql
immutable
as $$
  with obs as (
    select
      case
        when correct then (p * (1 - s)) / nullif(p * (1 - s) + (1 - p) * g, 0)
        else (p * s) / nullif(p * s + (1 - p) * (1 - g), 0)
      end as p_obs
  )

  select
    case
      when obs.p_obs is null then null
      else least(0.99, greatest(0.01, obs.p_obs + (1 - obs.p_obs) * t))
    end
  from obs
$$;

comment on function app.bkt_step(numeric, boolean, numeric, numeric, numeric)
is 'BKT ikili gözlem adımı; sonuç [0.01, 0.99] aralığında (BLUEPRINT §3.7).';

-- Sürekli gözlem (ders analizi, eğitmen tahmini): p + w·(m − p), w = 0.30·c.
-- c (güven) boşsa 0.8 kabul edilir; öğrenme geçişi uygulanmaz.
-- p ya da m boşsa NULL döner (sessizce 0.01'e kırpılmaz).
create or replace function app.blend_step(p numeric, m numeric, c numeric)
returns numeric
language sql
immutable
as $$
  select
    case
      when p is null or m is null then null
      else least(0.99, greatest(0.01, p + (0.30 * coalesce(c, 0.8)) * (m - p)))
    end
$$;

comment on function app.blend_step(numeric, numeric, numeric)
is 'Sürekli gözlem karışımı: p + 0.30·c·(m − p), c boşsa 0.8; [0.01, 0.99].';

-- Çıkarım gözlemi için yumuşatılmış tahmin olasılığı: g' = g + (1 − g)(1 − w).
create or replace function app.inferred_guess(g numeric, w numeric)
returns numeric
language sql
immutable
as $$
  select g + (1 - g) * (1 - w)
$$;

comment on function app.inferred_guess(numeric, numeric)
is 'Ön koşul çıkarımında kullanılan yumuşatılmış g: g + (1 − g)(1 − w).';
