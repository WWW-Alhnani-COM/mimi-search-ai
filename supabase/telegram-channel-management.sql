-- Mimi Search AI: Telegram public channel management foundation
-- Workspace-shared channel registry, candidate lifecycle, discovery provenance,
-- workspace discovery settings, and configurable channel evaluation rules.
-- Additive only: does not collect posts or alter Telegram auth/session storage.

create table if not exists public.telegram_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  telegram_peer_id bigint,
  username text,
  title text not null,
  about text,
  public_url text,
  channel_kind text not null default 'channel'
    check (channel_kind in ('channel','supergroup')),
  status text not null default 'candidate'
    check (status in ('candidate','review','approved','rejected','paused','archived')),
  country_code text references public.countries(code) on delete set null,
  city_id uuid references public.cities(id) on delete set null,
  category text,
  discovery_method text not null default 'manual'
    check (discovery_method in ('manual','search_engine','related_channel','import')),
  evaluation_score integer check (evaluation_score between 0 and 100),
  evaluation_details jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  last_discovered_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  check (telegram_peer_id is not null or username is not null),
  check (status <> 'approved' or approved_at is not null)
);

create unique index if not exists telegram_channels_workspace_peer_uidx
  on public.telegram_channels(workspace_id, telegram_peer_id)
  where telegram_peer_id is not null;

create unique index if not exists telegram_channels_workspace_username_uidx
  on public.telegram_channels(workspace_id, lower(ltrim(username, '@')))
  where username is not null;

create index if not exists telegram_channels_workspace_status_idx
  on public.telegram_channels(workspace_id, status, updated_at desc);

create index if not exists telegram_channels_workspace_country_idx
  on public.telegram_channels(workspace_id, country_code, city_id);

create table if not exists public.telegram_channel_discovery_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id uuid not null,
  source_kind text not null
    check (source_kind in ('manual','search_engine','related_channel','public_directory','import')),
  source_url text,
  search_query text,
  discovered_from_channel_id uuid,
  source_metadata jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  foreign key (channel_id, workspace_id)
    references public.telegram_channels(id, workspace_id) on delete cascade,
  foreign key (discovered_from_channel_id, workspace_id)
    references public.telegram_channels(id, workspace_id) on delete set null (discovered_from_channel_id),
  unique (id, workspace_id)
);

create index if not exists telegram_channel_sources_channel_idx
  on public.telegram_channel_discovery_sources(workspace_id, channel_id, discovered_at desc);

create table if not exists public.telegram_channel_relations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  channel_id uuid not null,
  related_channel_id uuid not null,
  relation_kind text not null default 'related'
    check (relation_kind in ('related','mentioned_with','same_topic','recommended_by_source')),
  evidence_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (channel_id, workspace_id)
    references public.telegram_channels(id, workspace_id) on delete cascade,
  foreign key (related_channel_id, workspace_id)
    references public.telegram_channels(id, workspace_id) on delete cascade,
  check (channel_id <> related_channel_id),
  unique (workspace_id, channel_id, related_channel_id, relation_kind)
);

create index if not exists telegram_channel_relations_related_idx
  on public.telegram_channel_relations(workspace_id, related_channel_id);

create table if not exists public.telegram_discovery_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  discovery_enabled boolean not null default false,
  schedule_interval text not null default 'daily'
    check (schedule_interval in ('hourly','every_6_hours','every_12_hours','daily','paused')),
  auto_approve_enabled boolean not null default false,
  minimum_approval_score integer not null default 85
    check (minimum_approval_score between 0 and 100),
  default_history_days integer not null default 10
    check (default_history_days in (1,3,7,10,15,30)),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discovery_enabled = false or schedule_interval <> 'paused')
);

create table if not exists public.telegram_channel_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rule_type text not null check (rule_type in ('include','exclude')),
  match_type text not null default 'contains'
    check (match_type in ('exact','phrase','contains','hashtag')),
  rule_value text not null check (length(trim(rule_value)) > 0),
  country_code text references public.countries(code) on delete cascade,
  enabled boolean not null default true,
  priority integer not null default 100,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, rule_type, match_type, rule_value, country_code)
);

create index if not exists telegram_channel_rules_workspace_enabled_idx
  on public.telegram_channel_rules(workspace_id, enabled, priority);

-- Workspace members can view the shared channel registry. Editors can manage it.
alter table public.telegram_channels enable row level security;
alter table public.telegram_channel_discovery_sources enable row level security;
alter table public.telegram_channel_relations enable row level security;
alter table public.telegram_discovery_settings enable row level security;
alter table public.telegram_channel_rules enable row level security;

drop policy if exists telegram_channels_workspace_select on public.telegram_channels;
create policy telegram_channels_workspace_select
  on public.telegram_channels for select to authenticated
  using (private.is_workspace_member(workspace_id));
drop policy if exists telegram_channels_workspace_insert on public.telegram_channels;
create policy telegram_channels_workspace_insert
  on public.telegram_channels for insert to authenticated
  with check (private.is_workspace_editor(workspace_id));
drop policy if exists telegram_channels_workspace_update on public.telegram_channels;
create policy telegram_channels_workspace_update
  on public.telegram_channels for update to authenticated
  using (private.is_workspace_editor(workspace_id))
  with check (private.is_workspace_editor(workspace_id));
drop policy if exists telegram_channels_workspace_delete on public.telegram_channels;
create policy telegram_channels_workspace_delete
  on public.telegram_channels for delete to authenticated
  using (private.is_workspace_editor(workspace_id));

drop policy if exists telegram_channel_sources_workspace_select on public.telegram_channel_discovery_sources;
create policy telegram_channel_sources_workspace_select
  on public.telegram_channel_discovery_sources for select to authenticated
  using (private.is_workspace_member(workspace_id));
drop policy if exists telegram_channel_sources_workspace_insert on public.telegram_channel_discovery_sources;
create policy telegram_channel_sources_workspace_insert
  on public.telegram_channel_discovery_sources for insert to authenticated
  with check (private.is_workspace_editor(workspace_id));
drop policy if exists telegram_channel_sources_workspace_update on public.telegram_channel_discovery_sources;
create policy telegram_channel_sources_workspace_update
  on public.telegram_channel_discovery_sources for update to authenticated
  using (private.is_workspace_editor(workspace_id))
  with check (private.is_workspace_editor(workspace_id));
drop policy if exists telegram_channel_sources_workspace_delete on public.telegram_channel_discovery_sources;
create policy telegram_channel_sources_workspace_delete
  on public.telegram_channel_discovery_sources for delete to authenticated
  using (private.is_workspace_editor(workspace_id));

drop policy if exists telegram_channel_relations_workspace_select on public.telegram_channel_relations;
create policy telegram_channel_relations_workspace_select
  on public.telegram_channel_relations for select to authenticated
  using (private.is_workspace_member(workspace_id));
drop policy if exists telegram_channel_relations_workspace_insert on public.telegram_channel_relations;
create policy telegram_channel_relations_workspace_insert
  on public.telegram_channel_relations for insert to authenticated
  with check (private.is_workspace_editor(workspace_id));
drop policy if exists telegram_channel_relations_workspace_update on public.telegram_channel_relations;
create policy telegram_channel_relations_workspace_update
  on public.telegram_channel_relations for update to authenticated
  using (private.is_workspace_editor(workspace_id))
  with check (private.is_workspace_editor(workspace_id));
drop policy if exists telegram_channel_relations_workspace_delete on public.telegram_channel_relations;
create policy telegram_channel_relations_workspace_delete
  on public.telegram_channel_relations for delete to authenticated
  using (private.is_workspace_editor(workspace_id));

drop policy if exists telegram_discovery_settings_workspace_select on public.telegram_discovery_settings;
create policy telegram_discovery_settings_workspace_select
  on public.telegram_discovery_settings for select to authenticated
  using (private.is_workspace_member(workspace_id));
drop policy if exists telegram_discovery_settings_workspace_insert on public.telegram_discovery_settings;
create policy telegram_discovery_settings_workspace_insert
  on public.telegram_discovery_settings for insert to authenticated
  with check (private.is_workspace_editor(workspace_id));
drop policy if exists telegram_discovery_settings_workspace_update on public.telegram_discovery_settings;
create policy telegram_discovery_settings_workspace_update
  on public.telegram_discovery_settings for update to authenticated
  using (private.is_workspace_editor(workspace_id))
  with check (private.is_workspace_editor(workspace_id));
drop policy if exists telegram_discovery_settings_workspace_delete on public.telegram_discovery_settings;
create policy telegram_discovery_settings_workspace_delete
  on public.telegram_discovery_settings for delete to authenticated
  using (private.is_workspace_editor(workspace_id));

drop policy if exists telegram_channel_rules_workspace_select on public.telegram_channel_rules;
create policy telegram_channel_rules_workspace_select
  on public.telegram_channel_rules for select to authenticated
  using (private.is_workspace_member(workspace_id));
drop policy if exists telegram_channel_rules_workspace_insert on public.telegram_channel_rules;
create policy telegram_channel_rules_workspace_insert
  on public.telegram_channel_rules for insert to authenticated
  with check (private.is_workspace_editor(workspace_id));
drop policy if exists telegram_channel_rules_workspace_update on public.telegram_channel_rules;
create policy telegram_channel_rules_workspace_update
  on public.telegram_channel_rules for update to authenticated
  using (private.is_workspace_editor(workspace_id))
  with check (private.is_workspace_editor(workspace_id));
drop policy if exists telegram_channel_rules_workspace_delete on public.telegram_channel_rules;
create policy telegram_channel_rules_workspace_delete
  on public.telegram_channel_rules for delete to authenticated
  using (private.is_workspace_editor(workspace_id));

-- New public-schema tables are explicitly granted; RLS remains the row boundary.
grant select, insert, update, delete on
  public.telegram_channels,
  public.telegram_channel_discovery_sources,
  public.telegram_channel_relations,
  public.telegram_discovery_settings,
  public.telegram_channel_rules
to authenticated;
grant all privileges on
  public.telegram_channels,
  public.telegram_channel_discovery_sources,
  public.telegram_channel_relations,
  public.telegram_discovery_settings,
  public.telegram_channel_rules
to service_role;

comment on table public.telegram_channels is
  'Workspace-shared registry of public Telegram channels and candidate lifecycle. No posts are collected by this table.';
comment on table public.telegram_channel_discovery_sources is
  'Public provenance for how a Telegram channel candidate was discovered.';
comment on table public.telegram_channel_relations is
  'Workspace-scoped public relationships between Telegram channels.';
comment on table public.telegram_discovery_settings is
  'Shared Telegram channel discovery schedule and approval thresholds per workspace.';
comment on table public.telegram_channel_rules is
  'Workspace-shared include/exclude rules used to evaluate public Telegram channel candidates.';
