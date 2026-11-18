-- Mimi Search AI: lead discovery foundation
-- Applied to the hosted Supabase project as an additive database migration.
-- Safe to run after supabase/schema.sql on a fresh project.
-- No demo leads or sample search records are inserted; only the real 22-country reference catalog is seeded.

create table if not exists public.countries (
  code text primary key check (code ~ '^[A-Z]{2}$'),
  name_ar text not null,
  name_en text not null,
  region text not null check (region in ('gulf','levant','north_africa','horn_of_africa')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into public.countries (code,name_ar,name_en,region) values
('SA','السعودية','Saudi Arabia','gulf'),('AE','الإمارات العربية المتحدة','United Arab Emirates','gulf'),
('KW','الكويت','Kuwait','gulf'),('QA','قطر','Qatar','gulf'),('BH','البحرين','Bahrain','gulf'),
('OM','عُمان','Oman','gulf'),('YE','اليمن','Yemen','gulf'),('IQ','العراق','Iraq','gulf'),
('JO','الأردن','Jordan','levant'),('PS','فلسطين','Palestine','levant'),('SY','سوريا','Syria','levant'),
('LB','لبنان','Lebanon','levant'),('EG','مصر','Egypt','north_africa'),('LY','ليبيا','Libya','north_africa'),
('TN','تونس','Tunisia','north_africa'),('DZ','الجزائر','Algeria','north_africa'),('MA','المغرب','Morocco','north_africa'),
('MR','موريتانيا','Mauritania','north_africa'),('SD','السودان','Sudan','horn_of_africa'),
('SO','الصومال','Somalia','horn_of_africa'),('DJ','جيبوتي','Djibouti','horn_of_africa'),
('KM','جزر القمر','Comoros','horn_of_africa')
on conflict (code) do update set name_ar=excluded.name_ar,name_en=excluded.name_en,region=excluded.region;

create table if not exists public.cities (
  id uuid primary key default gen_random_uuid(),
  country_code text not null references public.countries(code) on delete restrict,
  name_ar text not null, name_en text,
  created_at timestamptz not null default now(),
  unique(id,country_code), unique(country_code,name_ar)
);

create table if not exists public.keyword_sets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null, service_category text, description text,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,workspace_id), unique(workspace_id,name)
);

create table if not exists public.keyword_variants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  keyword_set_id uuid not null, term text not null,
  language_code text not null default 'ar', dialect text,
  match_type text not null default 'phrase' check(match_type in ('exact','phrase','contains','hashtag')),
  is_negative boolean not null default false, created_at timestamptz not null default now(),
  foreign key(keyword_set_id,workspace_id) references public.keyword_sets(id,workspace_id) on delete cascade,
  unique(keyword_set_id,term,match_type,is_negative)
);

create table if not exists public.source_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  platform text not null check(platform in ('facebook','telegram')),
  connection_label text not null, external_account_id text, display_name text,
  status text not null default 'pending' check(status in ('pending','connected','expired','revoked','error')),
  granted_scopes text[] not null default '{}',
  connected_by uuid references auth.users(id) on delete set null,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,workspace_id), unique(workspace_id,platform,external_account_id)
);

create table if not exists public.search_queries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null, search_text text,
  include_terms text[] not null default '{}', exclude_terms text[] not null default '{}',
  status text not null default 'draft' check(status in ('draft','active','paused','archived')),
  published_after timestamptz, published_before timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,workspace_id),
  check(published_after is null or published_before is null or published_after<=published_before)
);

create table if not exists public.search_query_sources (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  search_query_id uuid not null, platform text not null check(platform in ('facebook','telegram')),
  created_at timestamptz not null default now(), primary key(search_query_id,platform),
  foreign key(search_query_id,workspace_id) references public.search_queries(id,workspace_id) on delete cascade
);
create table if not exists public.search_query_countries (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  search_query_id uuid not null, country_code text not null references public.countries(code) on delete restrict,
  created_at timestamptz not null default now(), primary key(search_query_id,country_code),
  foreign key(search_query_id,workspace_id) references public.search_queries(id,workspace_id) on delete cascade
);
create table if not exists public.search_query_cities (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  search_query_id uuid not null, city_id uuid not null references public.cities(id) on delete restrict,
  created_at timestamptz not null default now(), primary key(search_query_id,city_id),
  foreign key(search_query_id,workspace_id) references public.search_queries(id,workspace_id) on delete cascade
);
create table if not exists public.search_query_keyword_sets (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  search_query_id uuid not null, keyword_set_id uuid not null,
  created_at timestamptz not null default now(), primary key(search_query_id,keyword_set_id),
  foreign key(search_query_id,workspace_id) references public.search_queries(id,workspace_id) on delete cascade,
  foreign key(keyword_set_id,workspace_id) references public.keyword_sets(id,workspace_id) on delete cascade
);

create table if not exists public.collection_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  search_query_id uuid not null, source_connection_id uuid,
  platform text not null check(platform in ('facebook','telegram')),
  status text not null default 'queued' check(status in ('queued','running','completed','partial','failed','cancelled')),
  started_at timestamptz, finished_at timestamptz,
  items_collected integer not null default 0 check(items_collected>=0),
  error_summary text, metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), unique(id,workspace_id),
  foreign key(search_query_id,workspace_id) references public.search_queries(id,workspace_id) on delete cascade,
  foreign key(source_connection_id,workspace_id) references public.source_connections(id,workspace_id) on delete set null (source_connection_id)
);

create table if not exists public.source_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  collection_run_id uuid not null,
  platform text not null check(platform in ('facebook','telegram')),
  external_item_id text not null, source_url text not null,
  source_name text, source_type text, author_public_id text, author_display_name text,
  text_content text, published_at timestamptz, collected_at timestamptz not null default now(),
  country_code text references public.countries(code) on delete set null,
  city_id uuid, raw_metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), unique(id,workspace_id),
  unique(workspace_id,platform,external_item_id),
  foreign key(collection_run_id,workspace_id) references public.collection_runs(id,workspace_id) on delete cascade,
  foreign key(city_id,country_code) references public.cities(id,country_code) on delete set null
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_type text not null default 'organization' check(lead_type in ('person','organization','unknown')),
  display_name text, organization_name text, normalized_identity text,
  country_code text references public.countries(code) on delete set null,
  city_id uuid, service_category text,
  status text not null default 'new' check(status in ('new','reviewed','qualified','disqualified','contacted','converted')),
  latest_score integer not null default 0 check(latest_score between 0 and 100),
  classification text not null default 'low' check(classification in ('high','review','low')),
  notes text, first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,workspace_id),
  foreign key(city_id,country_code) references public.cities(id,country_code) on delete set null,
  unique(workspace_id,normalized_identity)
);

create table if not exists public.lead_evidence (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null, source_item_id uuid not null, relevance_reason text,
  created_at timestamptz not null default now(),
  foreign key(lead_id,workspace_id) references public.leads(id,workspace_id) on delete cascade,
  foreign key(source_item_id,workspace_id) references public.source_items(id,workspace_id) on delete cascade,
  unique(lead_id,source_item_id)
);

create table if not exists public.lead_assessments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lead_id uuid not null,
  need_clarity integer not null check(need_clarity between 0 and 30),
  purchase_intent integer not null check(purchase_intent between 0 and 25),
  service_specificity integer not null check(service_specificity between 0 and 20),
  post_recency integer not null check(post_recency between 0 and 10),
  project_details integer not null check(project_details between 0 and 10),
  geographic_clarity integer not null check(geographic_clarity between 0 and 5),
  total_score integer not null check(total_score between 0 and 100),
  classification text not null check(classification in ('high','review','low')),
  reasons jsonb not null default '[]', scorer_version text not null default 'v1',
  created_at timestamptz not null default now(),
  foreign key(lead_id,workspace_id) references public.leads(id,workspace_id) on delete cascade,
  check(total_score=need_clarity+purchase_intent+service_specificity+post_recency+project_details+geographic_clarity),
  check((total_score>=75 and classification='high') or (total_score>=50 and total_score<75 and classification='review') or (total_score<50 and classification='low'))
);

create table if not exists private.source_connection_secrets (
  connection_id uuid primary key, workspace_id uuid not null,
  secret_payload_ciphertext text not null, encryption_key_version text not null,
  updated_at timestamptz not null default now(),
  foreign key(connection_id,workspace_id) references public.source_connections(id,workspace_id) on delete cascade
);

create or replace function private.is_workspace_admin(target_workspace uuid)
returns boolean language sql stable security definer set search_path=''
as $function$
  select exists(select 1 from public.workspace_members wm
    where wm.workspace_id=target_workspace and wm.user_id=(select auth.uid()) and wm.role in ('owner','admin'));
$function$;
revoke all on function private.is_workspace_admin(uuid) from public,anon;
grant execute on function private.is_workspace_admin(uuid) to authenticated;

alter table public.countries enable row level security;
alter table public.cities enable row level security;
alter table public.keyword_sets enable row level security;
alter table public.keyword_variants enable row level security;
alter table public.source_connections enable row level security;
alter table public.search_queries enable row level security;
alter table public.search_query_sources enable row level security;
alter table public.search_query_countries enable row level security;
alter table public.search_query_cities enable row level security;
alter table public.search_query_keyword_sets enable row level security;
alter table public.collection_runs enable row level security;
alter table public.source_items enable row level security;
alter table public.leads enable row level security;
alter table public.lead_evidence enable row level security;
alter table public.lead_assessments enable row level security;
alter table private.source_connection_secrets enable row level security;

drop policy if exists countries_read_authenticated on public.countries;
create policy countries_read_authenticated on public.countries for select to authenticated using(true);
drop policy if exists cities_read_authenticated on public.cities;
create policy cities_read_authenticated on public.cities for select to authenticated using(true);

do $policies$
declare t text;
begin
  foreach t in array array['keyword_sets','keyword_variants','search_queries','search_query_sources','search_query_countries','search_query_cities','search_query_keyword_sets'] loop
    execute format('drop policy if exists %I on public.%I',t||'_workspace_select',t);
    execute format('create policy %I on public.%I for select to authenticated using(private.is_workspace_member(workspace_id))',t||'_workspace_select',t);
    execute format('drop policy if exists %I on public.%I',t||'_workspace_insert',t);
    execute format('create policy %I on public.%I for insert to authenticated with check(private.is_workspace_member(workspace_id))',t||'_workspace_insert',t);
    execute format('drop policy if exists %I on public.%I',t||'_workspace_update',t);
    execute format('create policy %I on public.%I for update to authenticated using(private.is_workspace_member(workspace_id)) with check(private.is_workspace_member(workspace_id))',t||'_workspace_update',t);
    execute format('drop policy if exists %I on public.%I',t||'_workspace_delete',t);
    execute format('create policy %I on public.%I for delete to authenticated using(private.is_workspace_member(workspace_id))',t||'_workspace_delete',t);
  end loop;
end $policies$;

drop policy if exists source_connections_workspace_select on public.source_connections;
create policy source_connections_workspace_select on public.source_connections for select to authenticated using(private.is_workspace_member(workspace_id));
drop policy if exists source_connections_admin_insert on public.source_connections;
create policy source_connections_admin_insert on public.source_connections for insert to authenticated with check(private.is_workspace_admin(workspace_id));
drop policy if exists source_connections_admin_update on public.source_connections;
create policy source_connections_admin_update on public.source_connections for update to authenticated using(private.is_workspace_admin(workspace_id)) with check(private.is_workspace_admin(workspace_id));
drop policy if exists source_connections_admin_delete on public.source_connections;
create policy source_connections_admin_delete on public.source_connections for delete to authenticated using(private.is_workspace_admin(workspace_id));

do $read_policies$
declare t text;
begin
  foreach t in array array['collection_runs','source_items','leads','lead_evidence','lead_assessments'] loop
    execute format('drop policy if exists %I on public.%I',t||'_workspace_select',t);
    execute format('create policy %I on public.%I for select to authenticated using(private.is_workspace_member(workspace_id))',t||'_workspace_select',t);
  end loop;
end $read_policies$;

drop policy if exists leads_workspace_update on public.leads;
create policy leads_workspace_update on public.leads for update to authenticated
using(private.is_workspace_member(workspace_id)) with check(private.is_workspace_member(workspace_id));

drop policy if exists source_connection_secrets_service_only on private.source_connection_secrets;
create policy source_connection_secrets_service_only on private.source_connection_secrets
for all to service_role using(true) with check(true);

grant select on public.countries,public.cities to authenticated;
grant select,insert,update,delete on public.keyword_sets,public.keyword_variants,public.search_queries,
  public.search_query_sources,public.search_query_countries,public.search_query_cities,public.search_query_keyword_sets to authenticated;
grant select,insert,update,delete on public.source_connections to authenticated;
grant select on public.collection_runs,public.source_items,public.leads,public.lead_evidence,public.lead_assessments to authenticated;
grant update(status,notes,updated_at) on public.leads to authenticated;

revoke update on public.keyword_sets,public.keyword_variants,public.search_queries,
  public.search_query_sources,public.search_query_countries,public.search_query_cities,public.search_query_keyword_sets from authenticated;
grant update(name,service_category,description,is_active,updated_at) on public.keyword_sets to authenticated;
grant update(term,language_code,dialect,match_type,is_negative) on public.keyword_variants to authenticated;
grant update(name,search_text,include_terms,exclude_terms,status,published_after,published_before,updated_at) on public.search_queries to authenticated;

grant all privileges on all tables in schema public to service_role;
grant usage on schema private to service_role;
grant all privileges on private.source_connection_secrets to service_role;
revoke all on private.source_connection_secrets from public,anon,authenticated;

create index if not exists idx_cities_country on public.cities(country_code);
create index if not exists idx_keyword_sets_workspace on public.keyword_sets(workspace_id);
create index if not exists idx_keyword_variants_workspace_set on public.keyword_variants(workspace_id,keyword_set_id);
create index if not exists idx_source_connections_workspace on public.source_connections(workspace_id,platform,status);
create index if not exists idx_search_queries_workspace_status on public.search_queries(workspace_id,status,created_at desc);
create index if not exists idx_collection_runs_workspace_created on public.collection_runs(workspace_id,created_at desc);
create index if not exists idx_source_items_workspace_published on public.source_items(workspace_id,published_at desc);
create index if not exists idx_source_items_platform_published on public.source_items(workspace_id,platform,published_at desc);
create index if not exists idx_source_items_country on public.source_items(workspace_id,country_code);
create index if not exists idx_leads_workspace_score on public.leads(workspace_id,latest_score desc);
create index if not exists idx_leads_workspace_status on public.leads(workspace_id,status,updated_at desc);
create index if not exists idx_lead_evidence_workspace_lead on public.lead_evidence(workspace_id,lead_id);
create index if not exists idx_lead_assessments_workspace_lead on public.lead_assessments(workspace_id,lead_id,created_at desc);
create index if not exists idx_search_query_countries_country on public.search_query_countries(country_code);
create index if not exists idx_search_query_cities_city on public.search_query_cities(city_id);
create index if not exists idx_search_query_keyword_sets_set on public.search_query_keyword_sets(keyword_set_id);

-- Ensure all foreign-key columns are indexed, including composite tenant-safe relationships.
do $indexes$
declare fk record; col_list text; idx_name text;
begin
  for fk in
    select c.oid as constraint_oid,c.conrelid,c.conkey,n.nspname as schema_name,t.relname as table_name,c.conname
    from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
    where c.contype='f' and n.nspname in ('public','private')
      and not exists (
        select 1 from pg_index i where i.indrelid=c.conrelid and i.indisvalid
          and i.indnkeyatts>=cardinality(c.conkey)
          and (select array_agg(k.attnum::smallint order by k.ord)
               from unnest(i.indkey::smallint[]) with ordinality k(attnum,ord)
               where k.ord<=cardinality(c.conkey))=c.conkey::smallint[]
      )
  loop
    select string_agg(format('%I',a.attname),', ' order by u.ord) into col_list
    from unnest(fk.conkey) with ordinality u(attnum,ord)
    join pg_attribute a on a.attrelid=fk.conrelid and a.attnum=u.attnum;
    idx_name:=left('idx_fk_'||fk.table_name||'_'||substr(md5(fk.conname||fk.constraint_oid::text),1,10),63);
    execute format('create index if not exists %I on %I.%I (%s)',idx_name,fk.schema_name,fk.table_name,col_list);
  end loop;
end $indexes$;
