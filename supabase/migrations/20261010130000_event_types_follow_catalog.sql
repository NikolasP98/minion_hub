-- Slice 3 of 2026-10-10-hub-catalog-service-unification: catalog service ⇒
-- scheduling row (spec invariant I3). Ongoing sync for NEW saves lives in
-- src/server/services/scheduling-catalog-sync.ts (createSellable/
-- updateSellable call it on every save); this migration is the one-time
-- backfill for rows that existed before that code shipped. Idempotent and
-- safe to run on every org, any number of times — see the invariant
-- assertions at the bottom, which this file re-checks every run.

-- (a) title write-through: a linked row's title always equals its product's
-- current name.
update public.sched_event_types e
set title = p.name, updated_at = now()
from public.fin_products p
where e.product_id = p.id and e.org_id = p.org_id and e.title <> p.name;
--> statement-breakpoint

-- (b) active write-through: a linked row is active iff its product is.
update public.sched_event_types e
set active = p.active, updated_at = now()
from public.fin_products p
where e.product_id = p.id and e.org_id = p.org_id and e.active <> p.active;
--> statement-breakpoint

-- (c) create a row for every ACTIVE service-kind product that has none yet.
-- "service-kind" mirrors the pre-Slice1 derivation (SellableRow.kind in
-- pos.service.ts): no linked stk_items row. A bundle also has no stk_items
-- row and is treated as a service here, same as scheduling-catalog-sync.ts.
--
-- Per-org template: the (length, kind_id, resource-set) signature shared by
-- the most active existing rows in that org — approximated here, for this
-- one-time backfill, as the MODAL `length` among that org's active rows,
-- using one representative row's kind_id/resources (its oldest row at that
-- length). An org with no active rows yet gets 30 minutes and every active
-- resource, exactly like scheduling-catalog-sync.ts's resolveOrgTemplate.
with length_counts as (
  select org_id, length, count(*) as cnt
  from public.sched_event_types
  where active = true
  group by org_id, length
),
modal_length as (
  select org_id, length
  from (
    select org_id, length, cnt,
      row_number() over (partition by org_id order by cnt desc, length asc) as rnk
    from length_counts
  ) ranked
  where rnk = 1
),
modal_row as (
  select distinct on (e.org_id) e.org_id, e.id as event_type_id, e.length, e.kind_id
  from public.sched_event_types e
  join modal_length ml on ml.org_id = e.org_id and ml.length = e.length
  where e.active = true
  order by e.org_id, e.created_at asc
),
modal_resources as (
  select mr.org_id, array_agg(distinct r.resource_id) as resource_ids
  from modal_row mr
  join public.sched_event_type_resources r on r.event_type_id = mr.event_type_id
  group by mr.org_id
),
org_fallback_resources as (
  select org_id, array_agg(id order by id) as resource_ids
  from public.sched_resources
  where active = true
  group by org_id
),
org_template as (
  select o.org_id,
    coalesce(mr.length, 30) as length,
    mr.kind_id,
    coalesce(mres.resource_ids, fr.resource_ids, '{}') as resource_ids
  from (select distinct org_id from public.fin_products) o
  left join modal_row mr on mr.org_id = o.org_id
  left join modal_resources mres on mres.org_id = o.org_id
  left join org_fallback_resources fr on fr.org_id = o.org_id
),
missing as (
  select p.id as product_id, p.name, p.org_id
  from public.fin_products p
  where p.active = true
    and not exists (
      select 1 from public.stk_items i where i.fin_product_id = p.id and i.org_id = p.org_id
    )
    and not exists (
      select 1 from public.sched_event_types e where e.product_id = p.id and e.org_id = p.org_id
    )
),
slugged as (
  select m.*,
    nullif(trim(regexp_replace(lower(m.name), '[^a-z0-9]+', '-', 'g'), '-'), '') as base_slug
  from missing m
),
numbered as (
  select s.*, coalesce(s.base_slug, 'service') as safe_base,
    row_number() over (partition by s.org_id, coalesce(s.base_slug, 'service') order by s.product_id)
      as dup_rank
  from slugged s
),
final_slugs as (
  select n.*,
    case when dup_rank = 1 then safe_base else safe_base || '-' || dup_rank end as batch_slug
  from numbered n
),
unique_slugs as (
  select f.*,
    case when exists (
      select 1 from public.sched_event_types e2
      where e2.org_id = f.org_id and e2.slug = f.batch_slug
    ) then f.batch_slug || '-' || substr(f.product_id::text, 1, 8)
    else f.batch_slug end as final_slug
  from final_slugs f
),
inserted as (
  insert into public.sched_event_types (org_id, slug, title, length, kind_id, product_id, active)
  select u.org_id, u.final_slug, u.name, t.length, t.kind_id, u.product_id, true
  from unique_slugs u
  join org_template t on t.org_id = u.org_id
  returning id, org_id, product_id
)
insert into public.sched_event_type_resources (org_id, event_type_id, resource_id)
select ins.org_id, ins.id, r.resource_id
from inserted ins
join org_template t on t.org_id = ins.org_id
cross join lateral unnest(t.resource_ids) as r(resource_id)
where array_length(t.resource_ids, 1) > 0;
--> statement-breakpoint

-- Invariants (spec D6/D3 proof) — fail loudly instead of shipping a gap.
do $$
declare missing_active_count integer; stale_active_count integer;
begin
  select count(*) into missing_active_count
  from public.fin_products p
  where p.active = true
    and not exists (
      select 1 from public.stk_items i where i.fin_product_id = p.id and i.org_id = p.org_id
    )
    and not exists (
      select 1 from public.sched_event_types e
      where e.product_id = p.id and e.org_id = p.org_id and e.active = true
    );
  if missing_active_count <> 0 then
    raise exception
      'event_types_follow_catalog: % active service(s) still lack an active scheduling row',
      missing_active_count;
  end if;

  select count(*) into stale_active_count
  from public.sched_event_types e
  join public.fin_products p on p.id = e.product_id and p.org_id = e.org_id
  where e.active = true and p.active = false;
  if stale_active_count <> 0 then
    raise exception
      'event_types_follow_catalog: % scheduling row(s) still active on a retired product',
      stale_active_count;
  end if;
end $$;
