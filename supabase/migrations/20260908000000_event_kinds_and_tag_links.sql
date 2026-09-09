-- Event kinds + org-wide tag links (spec
-- 2026-09-08-hub-scheduling-calendar-views-tags-spec, S1). Event kinds are an
-- org-defined category on every calendar entry (booking or event type),
-- independent from sched_event_types (bookable services) — each service gets
-- a default kind via kind_id. tag_links is one polymorphic join table so
-- bookings, services (event types), and catalog products share the org-wide
-- crm_tags registry; contacts keep crm_contact_tags unchanged. Org isolation
-- via the app_ledger role + app.current_org_id GUC, same shape as
-- 20260903000000_hr_module.sql.

create table if not exists public.sched_event_kinds (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  name text not null,
  color text not null,            -- '#rrggbb' persisted domain data (like crm_tags.color)
  position double precision not null default 0,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists sched_event_kinds_org_name_uniq on public.sched_event_kinds (org_id, name);
create unique index if not exists sched_event_kinds_org_default_uniq on public.sched_event_kinds (org_id) where is_default;

alter table public.sched_bookings    add column if not exists kind_id uuid references public.sched_event_kinds(id) on delete set null;
alter table public.sched_event_types add column if not exists kind_id uuid references public.sched_event_kinds(id) on delete set null;

create table if not exists public.tag_links (
  org_id text not null,
  entity_kind text not null check (entity_kind in ('booking','event_type','product')),
  entity_id uuid not null,
  tag_id uuid not null references public.crm_tags(id) on delete cascade,
  applied_by uuid,
  applied_at timestamptz not null default now(),
  primary key (entity_kind, entity_id, tag_id)
);
create index if not exists tag_links_org_tag_idx on public.tag_links (org_id, tag_id);
create index if not exists tag_links_org_entity_idx on public.tag_links (org_id, entity_kind, entity_id);

-- RLS: org isolation via app_ledger + GUC (same shape as 20260903000000_hr_module.sql).
grant select, insert, update, delete on public.sched_event_kinds to app_ledger;
grant select, insert, update, delete on public.tag_links         to app_ledger;

alter table public.sched_event_kinds enable row level security;
alter table public.sched_event_kinds force  row level security;
alter table public.tag_links         enable row level security;
alter table public.tag_links         force  row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'sched_event_kinds_org_guc') then
    create policy sched_event_kinds_org_guc on public.sched_event_kinds
      for all using (org_id = current_setting('app.current_org_id', true))
              with check (org_id = current_setting('app.current_org_id', true));
  end if;
  if not exists (select 1 from pg_policies where policyname = 'tag_links_org_guc') then
    create policy tag_links_org_guc on public.tag_links
      for all using (org_id = current_setting('app.current_org_id', true))
              with check (org_id = current_setting('app.current_org_id', true));
  end if;
end $$;
