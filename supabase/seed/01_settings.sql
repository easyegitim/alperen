-- seed/01_settings.sql — sabitler (public.settings). Web ve worker açılışta okur; değerler jsonb.
insert into public.settings (key, value, description) values
  ('min_evidence', '5'::jsonb, 'Ustalık yüzdesini göstermek için gereken en az kanıt sayısı'),
  ('misconception_open_evidence', '3'::jsonb, 'Yanılgının açık sayılması için kanıt sayısı (apply_observation)'),
  ('max_options', '4'::jsonb, 'Soru bankası çoktan seçmeli şık sayısı (teşhis içeriği 4 şıklı; deneme sınavları 5 şık taşıyabilir)'),
  ('default_period', '"YKS 2027"'::jsonb, 'İlk kayıtta enrollments.period_label'),
  ('careless_weight', '0.5'::jsonb, 'careless/time hata nedenli teşhis gözleminin ağırlığı (apply_diagnosis)'),
  ('exam_guess_override', '0.2'::jsonb, 'Deneme cevabı gözleminde g (grade_exam_session)'),
  ('exam_blank_weight', '0.5'::jsonb, 'Boş bırakılan deneme sorusu gözleminin ağırlığı (grade_exam_session)'),
  ('exam_wrong_penalty', '0.25'::jsonb, 'Net hesabında yanlış başına düşülen doğru (ÖSYM: 4 yanlış 1 doğruyu götürür)'),
  ('memory_max_files', '12'::jsonb, 'Öğrenci başına en çok hafıza dosyası (memory_files_guard)'),
  ('memory_max_bytes', '8192'::jsonb, 'Hafıza dosyası en çok boyutu (bayt)'),
  ('memory_compact_bytes', '6144'::jsonb, 'Gece sıkıştırmasının devreye girdiği dosya boyutu (bayt)'),
  ('chat_recent_messages', '30'::jsonb, 'Koç sohbetinde birebir gönderilen son mesaj sayısı (eskisi özet)'),
  ('dossier_weak_leaves', '20'::jsonb, 'Dossier bloğundaki en zayıf yaprak sayısı'),
  ('dossier_strong_leaves', '10'::jsonb, 'Dossier bloğundaki en güçlü yaprak sayısı'),
  ('dossier_open_misconceptions', '8'::jsonb, 'Dossier bloğundaki en çok açık yanılgı sayısı'),
  ('lesson_auto_apply_threshold', '0.8'::jsonb, 'Ders iddiasının eğitmen onayı beklemeden uygulandığı güven (lessons varsayılanı)'),
  ('guardian_invite_hours', '72'::jsonb, 'Veli davetinin geçerlilik süresi (saat)'),
  ('llm_call_max_cost_usd', '5'::jsonb, 'Personel oturumunda log_llm_call çağrı başına en çok maliyet (USD; worker sınırsız)')
on conflict (key) do nothing;
