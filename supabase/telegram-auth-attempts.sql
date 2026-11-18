-- Short-lived, encrypted Telegram login state. No phone codes or 2FA passwords are stored in plaintext.
create table if not exists public.telegram_auth_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  state_ciphertext text not null,
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists telegram_auth_attempts_expiry_idx
  on public.telegram_auth_attempts (expires_at);

alter table public.telegram_auth_attempts enable row level security;
revoke all on public.telegram_auth_attempts from public, anon, authenticated;
grant all on public.telegram_auth_attempts to service_role;

comment on table public.telegram_auth_attempts is
  'Server-only encrypted transient Telegram login state. Rows expire after a short TTL and are inaccessible to anon/authenticated roles.';