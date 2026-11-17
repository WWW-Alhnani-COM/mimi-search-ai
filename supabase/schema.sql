-- Mimi Search AI initial schema
-- Run in Supabase SQL Editor. Tenant-owned tables use RLS.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  timezone text not null default 'Asia/Riyadh',
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);
create index if not exists activity_logs_workspace_created_idx on public.activity_logs(workspace_id, created_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_workspace_id uuid;
  display_name text;
begin
  display_name := coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1), 'مستخدم');
  insert into public.profiles (id, full_name)
  values (new.id, display_name)
  on conflict (id) do nothing;

  insert into public.workspaces (name, owner_id)
  values ('مساحة العمل الرئيسية', new.id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');

  insert into public.workspace_settings (workspace_id)
  values (new_workspace_id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.is_workspace_member(target_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace and wm.user_id = (select auth.uid())
  );
$$;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_settings enable row level security;
alter table public.activity_logs enable row level security;

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
for select to authenticated using (id = (select auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists workspace_select_members on public.workspaces;
create policy workspace_select_members on public.workspaces
for select to authenticated using (public.is_workspace_member(id));

drop policy if exists workspace_update_admins on public.workspaces;
create policy workspace_update_admins on public.workspaces
for update to authenticated
using (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = id and wm.user_id = (select auth.uid())
  and wm.role in ('owner', 'admin')
))
with check (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = id and wm.user_id = (select auth.uid())
  and wm.role in ('owner', 'admin')
));

drop policy if exists members_select_same_workspace on public.workspace_members;
create policy members_select_same_workspace on public.workspace_members
for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists settings_select_members on public.workspace_settings;
create policy settings_select_members on public.workspace_settings
for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists settings_update_admins on public.workspace_settings;
create policy settings_update_admins on public.workspace_settings
for update to authenticated
using (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = workspace_settings.workspace_id
  and wm.user_id = (select auth.uid()) and wm.role in ('owner', 'admin')
))
with check (exists (
  select 1 from public.workspace_members wm
  where wm.workspace_id = workspace_settings.workspace_id
  and wm.user_id = (select auth.uid()) and wm.role in ('owner', 'admin')
));

drop policy if exists activity_select_members on public.activity_logs;
create policy activity_select_members on public.activity_logs
for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists activity_insert_members on public.activity_logs;
create policy activity_insert_members on public.activity_logs
for insert to authenticated with check (
  user_id = (select auth.uid()) and public.is_workspace_member(workspace_id)
);

-- Remove broad table-level UPDATE grants, then grant only editable columns.
revoke update on table public.profiles from authenticated;
revoke update on table public.workspaces from authenticated;
revoke update on table public.workspace_settings from authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles, public.workspaces, public.workspace_members,
  public.workspace_settings, public.activity_logs to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;
grant update (name) on public.workspaces to authenticated;
grant update (timezone, preferences) on public.workspace_settings to authenticated;
grant insert on public.activity_logs to authenticated;

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.is_workspace_member(uuid) from anon;
grant execute on function public.is_workspace_member(uuid) to authenticated;
