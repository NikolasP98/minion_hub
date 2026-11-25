-- Spec 140 S4 audit fix: the active-lock unique indexes ignored the calling key, so a second API key
-- locking the same record or date range was answered `existing` (and shown the first key's label) instead
-- of getting its own lock. The key becomes part of each identity. Additive and idempotent; nothing is
-- rewritten (the replaced indexes were never needed by a key-less caller). The new indexes are built
-- before the old ones are dropped, in this one transaction, so there is no window without protection.
-- `coalesce` keeps a (never written by the app) key-less row unique as before.
create unique index if not exists org_record_locks_active_upto_key_uniq
  on public.org_record_locks
  (org_id, coalesce(record_type, ''), label, up_to, coalesce(api_key_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where up_to is not null and lifted_at is null;
create unique index if not exists org_record_locks_active_record_key_uniq
  on public.org_record_locks
  (org_id, record_type, record_id, coalesce(api_key_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where record_id is not null and lifted_at is null;

drop index if exists public.org_record_locks_active_upto_uniq;
drop index if exists public.org_record_locks_active_record_uniq;
