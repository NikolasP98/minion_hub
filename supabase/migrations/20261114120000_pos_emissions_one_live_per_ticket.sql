-- One live tax document per ticket (minion-meta spec 118, slice 3).
-- At most one pos_emissions row per (org, ticket) whose status is not 'error':
-- a second concurrent trigger fails on this index inside the transaction that
-- allocated its number, so the number rolls back and no second document exists.
-- An 'error' row stays outside the index, so a retry can emit again.
-- Owner gate: run first, expect 0 rows (0 in production on 2026-11-14):
--   select org_id, ticket_id, count(*) from pos_emissions
--   where status <> 'error' group by 1,2 having count(*) > 1;
create unique index if not exists pos_emissions_org_ticket_live_uniq
  on public.pos_emissions (org_id, ticket_id) where status <> 'error';
