-- 0012: F07 inceleme düzeltmeleri (gizlilik/kilit). Yalnız yerel; staging/production push onay ister.
--
-- 1) analysis_sets tarayıcıdan okunamaz. 0010'daki p_analysis_sets_read politikası, hak düşmüş (abonelik bitmiş,
--    satın alma iade edilmiş) kullanıcının tam skor + raporu Supabase REST ile okumasına izin veriyordu — CLAUDE.md
--    "kilitli değer sunucudan asla gönderilmez" kuralının analyses/coach_reports için geçerli olan hali (politika yok,
--    yalnız service role) burada da uygulanır.
drop policy if exists p_analysis_sets_read on public.analysis_sets;
comment on table public.analysis_sets is 'Set hash önbelleği (Ç11): fotoğraf yok; hesap silinince cascade; 1 yıl sonra cron siler. Tarayıcı politikası YOK (yalnız service role); kilitli skor ve rapor taşır.';

-- 2) purchases.consumed_at: tek seferlik raporun tüketildiği an. analysis_id "on delete set null" olduğundan rıza geri
--    alma (analizlerin silinmesi) satın almayı yeniden "bağlanmamış" hâle getiriyordu (bir satın alma = sınırsız rapor).
--    Tüketim artık ayrı sütunda tutulur: consumed_at dolu satın alma, analysis_id null olsa da yeniden kullanılamaz.
alter table public.purchases add column if not exists consumed_at timestamptz;
update public.purchases set consumed_at = coalesce(consumed_at, created_at) where analysis_id is not null and consumed_at is null;
comment on column public.purchases.consumed_at is 'one_time_report: bir analize bağlandığı an; analiz silinse de (analysis_id null) satın alma tüketilmiş kalır.';
