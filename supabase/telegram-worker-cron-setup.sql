-- Mimi Search AI Telegram worker schedule.
-- Run only after:
-- 1) The migration 20261118110000_telegram_worker_queue.sql has been applied.
-- 2) TELEGRAM_WORKER_SECRET is set in Vercel.
-- 3) The same secret and the worker URL are stored in Supabase Vault below.
--
-- Replace both placeholders before running this script. Do not commit real secrets.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret(
  'https://YOUR-VERCEL-DOMAIN/api/internal/telegram/worker',
  'mimi_telegram_worker_url'
);

select vault.create_secret(
  'REPLACE_WITH_THE_SAME_RANDOM_TELEGRAM_WORKER_SECRET',
  'mimi_telegram_worker_secret'
);

select cron.unschedule(jobid)
from cron.job
where jobname = 'mimi-telegram-worker';

select cron.schedule(
  'mimi-telegram-worker',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'mimi_telegram_worker_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'mimi_telegram_worker_secret')
      ),
      body := jsonb_build_object('trigger', 'supabase-cron'),
      timeout_milliseconds := 9000
    );
  $job$
);
