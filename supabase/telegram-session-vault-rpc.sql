-- Privileged RPC bridge for the private Telegram session vault.
-- These functions are executable only with a Supabase service-role JWT.
create or replace function public.store_telegram_session(
  target_connection_id uuid,
  target_workspace_id uuid,
  encrypted_payload text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  insert into private.source_connection_secrets (
    connection_id, workspace_id, secret_payload_ciphertext, encryption_key_version, updated_at
  ) values (
    target_connection_id, target_workspace_id, encrypted_payload, 'v1', now()
  )
  on conflict (connection_id) do update set
    workspace_id = excluded.workspace_id,
    secret_payload_ciphertext = excluded.secret_payload_ciphertext,
    encryption_key_version = excluded.encryption_key_version,
    updated_at = now();
end;
$$;

create or replace function public.read_telegram_session(target_connection_id uuid)
returns table(secret_payload_ciphertext text, workspace_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'forbidden';
  end if;
  return query
    select s.secret_payload_ciphertext, s.workspace_id
    from private.source_connection_secrets s
    where s.connection_id = target_connection_id;
end;
$$;

revoke all on function public.store_telegram_session(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.read_telegram_session(uuid) from public, anon, authenticated;
grant execute on function public.store_telegram_session(uuid,uuid,text) to service_role;
grant execute on function public.read_telegram_session(uuid) to service_role;