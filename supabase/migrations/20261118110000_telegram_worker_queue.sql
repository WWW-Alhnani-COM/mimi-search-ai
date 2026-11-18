-- Telegram worker queue and incremental collection metadata.
-- Additive only. Queue consumers use a service-role-only claim function.

create table if not exists public.telegram_worker_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  task_type text not null check (task_type in ('discover_channels','collect_channel','process_source_item')),
  status text not null default 'queued'
    check (status in ('queued','running','completed','partial','failed','cancelled')),
  payload jsonb not null default '{}'::jsonb,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 10),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  result jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);

create index if not exists telegram_worker_tasks_claim_idx
  on public.telegram_worker_tasks(status, available_at, created_at)
  where status in ('queued','running');
create index if not exists telegram_worker_tasks_workspace_idx
  on public.telegram_worker_tasks(workspace_id, created_at desc);

create unique index if not exists telegram_worker_tasks_one_active_discovery_idx
  on public.telegram_worker_tasks(workspace_id, task_type)
  where status in ('queued','running') and task_type = 'discover_channels';

alter table public.telegram_channels
  add column if not exists last_synced_message_id bigint,
  add column if not exists history_cursor_message_id bigint,
  add column if not exists initial_history_latest_message_id bigint,
  add column if not exists initial_history_complete boolean not null default false,
  add column if not exists last_collected_at timestamptz,
  add column if not exists collection_enabled boolean not null default false,
  add column if not exists last_collection_status text
    check (last_collection_status is null or last_collection_status in ('idle','queued','running','completed','partial','failed'));

alter table public.telegram_worker_tasks enable row level security;

drop policy if exists telegram_worker_tasks_workspace_select on public.telegram_worker_tasks;
create policy telegram_worker_tasks_workspace_select
  on public.telegram_worker_tasks for select to authenticated
  using (private.is_workspace_member(workspace_id));

drop policy if exists telegram_worker_tasks_workspace_insert on public.telegram_worker_tasks;
create policy telegram_worker_tasks_workspace_insert
  on public.telegram_worker_tasks for insert to authenticated
  with check (
    private.is_workspace_editor(workspace_id)
    and created_by = (select auth.uid())
    and status = 'queued'
  );

grant select, insert on public.telegram_worker_tasks to authenticated;
grant all privileges on public.telegram_worker_tasks to service_role;

create or replace function public.claim_telegram_worker_tasks(
  p_worker_id text,
  p_limit integer default 3
)
returns setof public.telegram_worker_tasks
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_worker_id is null or length(trim(p_worker_id)) < 3 or length(p_worker_id) > 120 then
    raise exception 'invalid_worker_id';
  end if;

  return query
  with picked as (
    select t.id
    from public.telegram_worker_tasks t
    where (
      (t.status = 'queued' and t.available_at <= now())
      or (t.status = 'running' and t.locked_at < now() - interval '10 minutes')
    )
    and t.attempts < t.max_attempts
    order by t.available_at, t.created_at
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 3), 10))
  )
  update public.telegram_worker_tasks t
  set status = 'running',
      attempts = t.attempts + 1,
      locked_at = now(),
      locked_by = p_worker_id,
      started_at = coalesce(t.started_at, now()),
      updated_at = now()
  from picked
  where t.id = picked.id
  returning t.*;
end;
$function$;

revoke all on function public.claim_telegram_worker_tasks(text,integer) from public, anon, authenticated;
grant execute on function public.claim_telegram_worker_tasks(text,integer) to service_role;

create index if not exists telegram_channels_collection_due_idx
  on public.telegram_channels(workspace_id, last_collected_at)
  where status = 'approved' and collection_enabled = true;

-- Channel-based collection runs do not require a user search query.
alter table public.collection_runs alter column search_query_id drop not null;
alter table public.collection_runs
  add column if not exists telegram_channel_id uuid;
alter table public.collection_runs
  drop constraint if exists collection_runs_telegram_channel_id_fkey;
alter table public.collection_runs
  add constraint collection_runs_telegram_channel_id_fkey
  foreign key (telegram_channel_id, workspace_id)
  references public.telegram_channels(id, workspace_id) on delete set null (telegram_channel_id);

create unique index if not exists telegram_worker_tasks_one_active_collection_idx
  on public.telegram_worker_tasks(workspace_id, (payload->>'channelId'))
  where status in ('queued','running') and task_type = 'collect_channel';

create index if not exists telegram_channels_history_cursor_idx
  on public.telegram_channels(workspace_id, history_cursor_message_id)
  where initial_history_complete = false;

create unique index if not exists telegram_channel_sources_deduplicate_idx
  on public.telegram_channel_discovery_sources(workspace_id, channel_id, source_kind, source_url)
  where source_url is not null;

create unique index if not exists telegram_worker_tasks_one_active_source_item_idx
  on public.telegram_worker_tasks(workspace_id, (payload->>'sourceItemId'))
  where status in ('queued','running') and task_type = 'process_source_item';

-- Optional AI enhancement with a strict, workspace-level daily request budget.
alter table public.telegram_discovery_settings
  add column if not exists ai_enabled boolean not null default false,
  add column if not exists ai_provider text not null default 'local'
    check (ai_provider in ('local','gemini')),
  add column if not exists ai_model text not null default 'gemini-2.5-flash-lite'
    check (ai_model in ('gemini-2.5-flash-lite','gemini-2.5-flash')),
  add column if not exists ai_daily_request_limit integer not null default 50
    check (ai_daily_request_limit between 1 and 100);

create table if not exists public.telegram_ai_usage (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  usage_date date not null default (now() at time zone 'utc')::date,
  requests integer not null default 0 check (requests >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, usage_date)
);
alter table public.telegram_ai_usage enable row level security;
drop policy if exists telegram_ai_usage_workspace_select on public.telegram_ai_usage;
create policy telegram_ai_usage_workspace_select
  on public.telegram_ai_usage for select to authenticated
  using (private.is_workspace_member(workspace_id));
grant select on public.telegram_ai_usage to authenticated;
grant all privileges on public.telegram_ai_usage to service_role;

create or replace function public.claim_telegram_ai_request(
  p_workspace_id uuid,
  p_daily_limit integer
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare claimed boolean := false;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 100 then
    raise exception 'invalid_daily_limit';
  end if;

  insert into public.telegram_ai_usage(workspace_id, usage_date)
  values (p_workspace_id, (now() at time zone 'utc')::date)
  on conflict (workspace_id, usage_date) do nothing;

  update public.telegram_ai_usage
  set requests = requests + 1, updated_at = now()
  where workspace_id = p_workspace_id
    and usage_date = (now() at time zone 'utc')::date
    and requests < p_daily_limit;
  claimed := found;
  return claimed;
end;
$function$;

create or replace function public.record_telegram_ai_usage(
  p_workspace_id uuid,
  p_input_tokens bigint default 0,
  p_output_tokens bigint default 0
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  update public.telegram_ai_usage
  set input_tokens = input_tokens + greatest(coalesce(p_input_tokens,0),0),
      output_tokens = output_tokens + greatest(coalesce(p_output_tokens,0),0),
      updated_at = now()
  where workspace_id = p_workspace_id
    and usage_date = (now() at time zone 'utc')::date;
end;
$function$;

revoke all on function public.claim_telegram_ai_request(uuid,integer) from public,anon,authenticated;
grant execute on function public.claim_telegram_ai_request(uuid,integer) to service_role;
revoke all on function public.record_telegram_ai_usage(uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.record_telegram_ai_usage(uuid,bigint,bigint) to service_role;

-- Schedule metadata is read by the worker; no schedule is activated by this migration.
alter table public.telegram_discovery_settings
  add column if not exists next_discovery_at timestamptz,
  add column if not exists last_discovery_at timestamptz,
  add column if not exists last_discovery_status text
    check (last_discovery_status is null or last_discovery_status in ('queued','running','completed','partial','failed'));
create index if not exists telegram_discovery_settings_due_idx
  on public.telegram_discovery_settings(next_discovery_at)
  where discovery_enabled = true;

-- Monthly free-tier request budget for the shared Tavily search key.
create table if not exists public.telegram_discovery_provider_usage (
  provider text not null check (provider = 'tavily'),
  usage_month date not null,
  requests integer not null default 0 check (requests >= 0),
  updated_at timestamptz not null default now(),
  primary key (provider, usage_month)
);
alter table public.telegram_discovery_provider_usage enable row level security;
revoke all on public.telegram_discovery_provider_usage from public, anon, authenticated;
grant all privileges on public.telegram_discovery_provider_usage to service_role;

create or replace function public.claim_telegram_discovery_credit(p_monthly_limit integer default 900)
returns boolean language plpgsql security definer set search_path to ''
as $function$
declare claimed boolean := false;
declare month_start date := date_trunc('month', now() at time zone 'utc')::date;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'forbidden'; end if;
  if p_monthly_limit is null or p_monthly_limit < 1 or p_monthly_limit > 900 then raise exception 'invalid_monthly_limit'; end if;
  insert into public.telegram_discovery_provider_usage(provider, usage_month)
  values ('tavily', month_start) on conflict (provider, usage_month) do nothing;
  update public.telegram_discovery_provider_usage
  set requests = requests + 1, updated_at = now()
  where provider = 'tavily' and usage_month = month_start and requests < p_monthly_limit;
  claimed := found;
  return claimed;
end;
$function$;
revoke all on function public.claim_telegram_discovery_credit(integer) from public,anon,authenticated;
grant execute on function public.claim_telegram_discovery_credit(integer) to service_role;
