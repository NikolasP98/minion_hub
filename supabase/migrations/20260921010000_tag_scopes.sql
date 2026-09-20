-- Tag scopes (owner directive 2026-09-19): every category owns its own tags and
-- they are never interchangeable — customer (crm) tags cannot be applied to
-- stock items, products/services/recipes (catalog) or events, and so on.
-- `crm_tags.scope` names the category; uniqueness becomes (org, scope, name)
-- so "VIP" may exist once per category. Stock items join the polymorphic
-- tag_links table (entity_kind='item') — recipes and products INHERIT those
-- tags from their ingredients at read time, never by copying rows.
--
-- Backfill: every existing tag is a crm tag. Tags that were applied through
-- tag_links (bookings → event scope; event types + products → catalog scope)
-- move to that scope when nothing else uses them, and are CLONED into it when
-- a contact also carries them (or they straddle both link scopes), with the
-- links repointed. No application is lost.

alter table public.crm_tags add column if not exists scope text not null default 'crm';
alter table public.crm_tags drop constraint if exists crm_tags_scope_check;
alter table public.crm_tags
  add constraint crm_tags_scope_check check (scope in ('crm', 'stock', 'catalog', 'event'));

-- (org, name) uniqueness would block the clones below — the scoped index
-- replaces it at the end.
drop index if exists public.crm_tags_org_name_uniq;

-- 1) Linked, never on a contact, one link scope → move the tag as-is.
with usage as (
  select t.id,
         bool_or(l.entity_kind = 'booking') as ev,
         bool_or(l.entity_kind in ('event_type', 'product')) as cat
    from public.crm_tags t
    join public.tag_links l on l.tag_id = t.id
   where t.scope = 'crm'
     and t.kind = 'manual'
     and not exists (select 1 from public.crm_contact_tags c where c.tag_id = t.id)
   group by t.id
)
update public.crm_tags t
   set scope = case when u.ev then 'event' else 'catalog' end
  from usage u
 where u.id = t.id
   and u.ev <> u.cat;

-- 2) Everything still crm-scoped that carries links: clone per link scope and
--    repoint those links (the contact applications stay on the original).
do $$
declare
  r record;
  target_id uuid;
  kinds text[];
begin
  for r in
    select distinct t.id, t.org_id, t.name, t.color, t.position, t.created_by,
           case when l.entity_kind = 'booking' then 'event' else 'catalog' end as target
      from public.crm_tags t
      join public.tag_links l on l.tag_id = t.id
     where t.scope = 'crm'
  loop
    kinds := case when r.target = 'event' then array['booking'] else array['event_type', 'product'] end;
    select id into target_id
      from public.crm_tags
     where org_id = r.org_id and scope = r.target and name = r.name;
    if target_id is null then
      insert into public.crm_tags (org_id, name, color, kind, rule, position, created_by, scope)
      values (r.org_id, r.name, r.color, 'manual', null, r.position, r.created_by, r.target)
      returning id into target_id;
    end if;
    update public.tag_links l
       set tag_id = target_id
     where l.tag_id = r.id
       and l.entity_kind = any (kinds)
       and not exists (
         select 1 from public.tag_links x
          where x.entity_kind = l.entity_kind and x.entity_id = l.entity_id and x.tag_id = target_id
       );
    -- Duplicates the guard above skipped (entity already had the clone).
    delete from public.tag_links l where l.tag_id = r.id and l.entity_kind = any (kinds);
  end loop;
end $$;

create unique index if not exists crm_tags_org_scope_name_uniq
  on public.crm_tags (org_id, scope, name);
create index if not exists crm_tags_org_scope_idx on public.crm_tags (org_id, scope);

-- Stock items join the polymorphic link table.
alter table public.tag_links drop constraint if exists tag_links_entity_kind_check;
alter table public.tag_links
  add constraint tag_links_entity_kind_check
  check (entity_kind in ('booking', 'event_type', 'product', 'item'));
