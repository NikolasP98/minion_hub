-- Spec 121 S1: organization API keys for form doors (data-model.md `org_api_keys`).
-- The key text is never stored: only its 8-hex prefix (lookup) and the SHA-256 hex
-- of the whole key. Keys are revoked, never deleted (no delete grant).

create table if not exists public.org_api_keys (
  id           uuid primary key default gen_random_uuid(),
  org_id       text not null,
  name         text not null check (char_length(btrim(name)) between 1 and 60),
  prefix       text not null unique check (prefix ~ '^[0-9a-f]{8}$'),
  key_hash     text not null,
  created_by   uuid,                      -- plain uuid: the key outlives its creator
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,               -- at most one minute stale
  revoked_by   uuid,
  revoked_at   timestamptz                -- revoked = not null; never cleared
);
create index if not exists org_api_keys_active_idx
  on public.org_api_keys (org_id) where revoked_at is null;

alter table public.org_api_keys enable row level security;
alter table public.org_api_keys force row level security;
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'org_api_keys' and policyname = 'org_api_keys_org_guc'
  ) then
    create policy org_api_keys_org_guc on public.org_api_keys
      using (org_id = current_setting('app.current_org_id', true))
      with check (org_id = current_setting('app.current_org_id', true));
  end if;
end $$;
revoke all on public.org_api_keys from public, anon, authenticated;
grant select, insert, update on public.org_api_keys to app_ledger;

-- Which key stored a submission (null = sent without a key). No FK: keys are never deleted.
alter table public.crm_door_submissions add column if not exists api_key_id uuid;
