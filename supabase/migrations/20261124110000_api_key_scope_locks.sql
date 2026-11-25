-- Spec 140 S4: org API keys may carry the `locks` scope (the record-lock webhook).
-- Drop and re-add in one file (one transaction), so there is no window without the check.
-- Existing keys keep their scopes; none gains `locks`.
alter table public.org_api_keys drop constraint if exists org_api_keys_scopes_known;
alter table public.org_api_keys
  add constraint org_api_keys_scopes_known check (scopes <@ array['sandbox', 'locks']::text[]);
