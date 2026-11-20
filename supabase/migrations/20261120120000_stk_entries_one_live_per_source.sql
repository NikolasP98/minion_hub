-- One live stock entry per source (spec 138 H2).
--
-- What: partial unique index so at most one draft/submitted stk_entries row exists per
--   (org_id, metadata.source, metadata.sourceId). Cancelled entries are history and are not constrained.
-- Why: the application already refuses a second live entry for a source under the per-org stock gate
--   (insertSourcedIssueEntry). A script or repair that writes without the gate was stopped by nothing;
--   now the database refuses it. No application code changes.
-- Additive only: no rows are changed. The runner wraps this file in a transaction
--   (scripts/db-migrate-core.ts applyHubMigration), so there is no BEGIN/COMMIT here.
--
-- Owner gate: run this duplicate query first, expect 0 rows (the migration also aborts if any exist):
--   select org_id, metadata->>'source' as source, metadata->>'sourceId' as source_id, count(*), array_agg(id)
--   from public.stk_entries
--   where status in ('draft','submitted')
--     and coalesce(metadata->>'source','') <> '' and coalesce(metadata->>'sourceId','') <> ''
--   group by 1, 2, 3 having count(*) > 1;
lock table public.stk_entries in share row exclusive mode;

do $$
declare
  dups text;
begin
  select string_agg(format('(org=%s source=%s sourceId=%s n=%s)', org_id, src, sid, n), ', ')
    into dups
  from (
    select org_id, metadata->>'source' as src, metadata->>'sourceId' as sid, count(*) as n
    from public.stk_entries
    where status in ('draft', 'submitted')
      and coalesce(metadata->>'source', '') <> ''
      and coalesce(metadata->>'sourceId', '') <> ''
    group by org_id, metadata->>'source', metadata->>'sourceId'
    having count(*) > 1
  ) d;
  if dups is not null then
    raise exception 'Duplicate live stock entries per source; resolve (cancel the extra) then rerun: %', dups;
  end if;
end $$;

create unique index if not exists stk_entries_org_live_source_uniq
  on public.stk_entries (org_id, (metadata->>'source'), (metadata->>'sourceId'))
  where status in ('draft', 'submitted')
    and coalesce(metadata->>'source', '') <> ''
    and coalesce(metadata->>'sourceId', '') <> '';
