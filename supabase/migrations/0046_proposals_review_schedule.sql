-- 0046: gece müfredat önerisi incelemesi zamanlaması.
-- curriculum.proposals.review (apps/worker/src/jobs/curriculum-proposals.ts) açık önerileri Batch ile inceler; sonuçları
-- curriculum.proposals.collect işler ve otopilot kabulü buradan çalışır. Bugüne dek hiç zamanlanmamıştı (yalnız elle
-- kuyruğa alınabiliyordu), bu yüzden otopilot kabulü fiilen hiç devreye girmiyordu.
-- Worker zamanlaması apps/worker/src/schedules.ts: '30 2 * * *' (Europe/Istanbul) = '30 23 * * *' UTC (pg_cron UTC çalışır).
-- pg_cron sahibi ise (0016) worker kendi zamanlamasını kurmaz; eşi burada.
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is not null then
    perform cron.schedule('ogrenmen-curriculum-proposals-review', '30 23 * * *',
                          $c$select public.enqueue_job('curriculum.proposals.review', '{}'::jsonb)$c$);  -- Istanbul 02:30
  end if;
end
$$;
