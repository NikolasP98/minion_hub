-- Spec 138 H4. stk_ledger.created_at: when the row was WRITTEN.
--
-- `posted_at` is the date a movement is posted to and can be backdated. `created_at` is the
-- instant the row was inserted. For rows that exist before this migration the true write time
-- is unknown, so they are filled with the LATER of `posted_at` and their entry's `created_at`:
-- the earliest moment the row can have been written. That is a lower bound, not the true time.
-- Rows whose entry cannot be found (none expected: entry_id is a foreign key) fall back to
-- `posted_at`.
--
-- stk_ledger has FORCE ROW LEVEL SECURITY with a policy on app.current_org_id, so an actor that
-- does not bypass RLS would update zero rows. Require the visibility this backfill depends on
-- (same guard as 20261003170000_notification_audience_projection.sql) rather than assuming it.
-- No BEGIN/COMMIT: the runner wraps each file in a transaction (scripts/db-migrate-core.ts).

do $$ begin
  if not exists (select 1 from pg_roles
    where rolname = current_user and (rolbypassrls or rolsuper)) then
    raise exception 'stk_ledger.created_at backfill requires an actor that bypasses row level security';
  end if;
end $$;
--> statement-breakpoint
alter table public.stk_ledger add column if not exists created_at timestamptz;
--> statement-breakpoint
update public.stk_ledger l
   set created_at = greatest(l.posted_at, coalesce(e.created_at, l.posted_at))
  from public.stk_entries e
 where e.id = l.entry_id and l.created_at is null;
--> statement-breakpoint
update public.stk_ledger set created_at = posted_at where created_at is null;
--> statement-breakpoint
do $$ begin
  if exists (select 1 from public.stk_ledger where created_at is null) then
    raise exception 'stk_ledger.created_at backfill left null rows';
  end if;
end $$;
--> statement-breakpoint
alter table public.stk_ledger
  alter column created_at set default now(),
  alter column created_at set not null;
