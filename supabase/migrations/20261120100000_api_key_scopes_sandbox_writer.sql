-- Spec 136 S5: org API keys carry scopes; sandbox elements record which key wrote them.
-- Existing keys get no scopes, so none gains the MCP ability silently.
alter table public.org_api_keys
  add column if not exists scopes text[] not null default '{}';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'org_api_keys_scopes_known') then
    alter table public.org_api_keys
      add constraint org_api_keys_scopes_known check (scopes <@ array['sandbox']::text[]);
  end if;
end $$;

-- Plain uuid, no FK: keys are never deleted and the element outlives nothing it references.
alter table public.sandbox_elements add column if not exists written_by_key uuid;
