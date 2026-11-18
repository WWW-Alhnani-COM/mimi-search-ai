-- Follow-up hardening for Telegram channel management.
-- Keeps incomplete public discoveries representable without inventing a channel title.
alter table public.telegram_channels alter column title drop not null;
drop index if exists public.telegram_channels_workspace_username_uidx;
create unique index telegram_channels_workspace_username_uidx
  on public.telegram_channels(workspace_id, lower(ltrim(trim(username), '@')))
  where username is not null;
alter table public.telegram_channels
  drop constraint if exists telegram_channels_check;
alter table public.telegram_channels
  add constraint telegram_channels_identity_check
  check (telegram_peer_id is not null or (username is not null and length(trim(username)) > 0));

create index if not exists telegram_channel_sources_channel_fk_idx
  on public.telegram_channel_discovery_sources(channel_id, workspace_id);
create index if not exists telegram_channel_sources_origin_fk_idx
  on public.telegram_channel_discovery_sources(discovered_from_channel_id, workspace_id)
  where discovered_from_channel_id is not null;
create index if not exists telegram_channel_relations_channel_fk_idx
  on public.telegram_channel_relations(channel_id, workspace_id);
create index if not exists telegram_channel_relations_related_fk_idx
  on public.telegram_channel_relations(related_channel_id, workspace_id);
create index if not exists telegram_channel_rules_country_fk_idx
  on public.telegram_channel_rules(country_code) where country_code is not null;
create index if not exists telegram_channel_rules_created_by_fk_idx
  on public.telegram_channel_rules(created_by) where created_by is not null;
create index if not exists telegram_channels_approved_by_fk_idx
  on public.telegram_channels(approved_by) where approved_by is not null;
create index if not exists telegram_channels_city_fk_idx
  on public.telegram_channels(city_id) where city_id is not null;
create index if not exists telegram_channels_country_fk_idx
  on public.telegram_channels(country_code) where country_code is not null;
create index if not exists telegram_channels_created_by_fk_idx
  on public.telegram_channels(created_by) where created_by is not null;
create index if not exists telegram_discovery_settings_updated_by_fk_idx
  on public.telegram_discovery_settings(updated_by) where updated_by is not null;
