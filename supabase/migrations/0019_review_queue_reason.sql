-- 0019_review_queue_reason.sql — panel kuyruğunda (public.v_review_queue) soru satırının nedeni verification.review_note'u
-- da okur. Uygulanmış 0013 yeniden yazılmaz; bu dosya görünümü yalnız "reason" ifadesi değişerek yeniden tanımlar.
-- Neden: pipelines/tablet 2 deneme kuralıyla kuyruğa düşen sorunun notunu ("2 başarısız deneme …", ogrenmen_tablet
-- shared.TWO_ATTEMPT_PREFIX; şekil düzeltme notları da) questions.verification->>'review_note' içine yazar; batch_worker'ın
-- questions.review_note üzerinde yetkisi yoktur (0014: o sütun yalnız approve_question yoluyla eğitmenindir). 0013 nedeni
-- yalnız q.review_note'tan aldığı için eğitmen bu notu hiç görmüyor, genel "Soru incelemesi (llm)" metnini görüyordu.
-- Öncelik: eğitmen notu (review_note) → boru hattı notu (verification.review_note) → genel metin.
-- Sütunlar (adı, sırası, türü), diğer yedi union kolu, security_invoker = true (çağıranın RLS'i), yorum ve yetki 0013 ile
-- aynıdır: CREATE OR REPLACE VIEW sahibi, yorumu ve GRANT'leri korur; seçenek listesi yine açıkça verilir (WITH
-- verilmezse görünüm seçenekleri sıfırlanır), GRANT de belgelemek için yinelenir (etkisiz, matris değişmez).

create or replace view public.v_review_queue with (security_invoker = true) as
select 'question'::text as kind, q.id::text as ref_id, q.created_at,
       coalesce(q.review_note, q.verification ->> 'review_note', 'Soru incelemesi (' || q.source || ')') as reason,
       null::text as student_ref, q.skill_ids[1] as staff_hint
  from public.questions as q
 where q.status = 'pending_review'
union all
select 'figure', f.id::text, f.created_at,
       'Şekil incelemesi: render ' || f.render_status || ', görsel denetim ' || f.vision_status, null, f.tool
  from public.figures as f
 where f.review_status = 'pending' and f.render_status <> 'pending'
union all
select 'misconception', mc.id::text, mc.first_seen, mc.text_instructor, st.public_ref, mc.skill_id
  from public.misconceptions as mc
  join public.enrollments as e on e.id = mc.enrollment_id
  join public.students as st on st.id = e.student_id
 where mc.status = 'pending_review'
union all
select 'pool', cp.id::text, cp.created_at, 'Havuz içeriği (' || cp.kind || ', ' || cp.mode || ')', null, cp.skill_id
  from public.content_pool as cp
 where cp.status = 'pending_review'
union all
select 'lesson_analysis', la.id::text, la.created_at, 'Ders raporu onay bekliyor', st.public_ref, l.held_at::date::text
  from public.lesson_analyses as la
  join public.lessons as l on l.id = la.lesson_id
  join public.enrollments as e on e.id = l.enrollment_id
  join public.students as st on st.id = e.student_id
 where la.status = 'draft'
union all
select 'flagged_response', br.id::text, coalesce(br.flagged_at, br.created_at), coalesce(br.flag_reason, 'İşaretli cevap'),
       st.public_ref, br.purpose
  from public.bot_responses as br
  left join public.students as st on st.id = br.student_id
 where br.flagged
union all
select 'priority_plan', pp.id::text, pp.created_at, 'Öncelik planı onay bekliyor', null, pp.period
  from public.exam_priority_plans as pp
 where pp.status = 'pending_review'
union all
select 'research', ro.id::text, ro.created_at, 'Araştırma çıktısı inceleme bekliyor', st.public_ref, null
  from public.research_outputs as ro
  join public.research_requests as rr on rr.id = ro.request_id
  left join public.students as st on st.id = rr.student_id
 where ro.status = 'pending_review';
comment on view public.v_review_queue is 'Eğitmen kuyruğu (tek görünüm, union all); çağıranın RLS''i geçerli.';
grant select on public.v_review_queue to authenticated;
