-- org_areas — first-class organizational areas (departments) per org.
--
-- An "area" is a color-coded division of an organization (Sales, Marketing,
-- Operations, Development, Support, …). It groups the agents and users that
-- work in it and tags the skills/process-docs that define that area's behavior.
-- The OVERVIEW graph renders the org at the center, areas as the first ring,
-- then each area's skills → agents → users as concentric sectors.
--
-- Membership is stored as id arrays rather than join tables because the members
-- are heterogeneous and live in different stores: `agent_ids` are gateway agent
-- string ids (the gateway has no per-org table — agents stream over the WS),
-- `skill_keys` are skill identifiers, and only `user_ids` are local profile
-- uuids. Arrays keep the area self-contained and the assignment editor a single
-- upsert. Org scoping is the security boundary; the hub reads/writes via the
-- service role, the gateway never touches this table.

create table if not exists public.org_areas (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null,
  slug            text not null,
  -- lucide-svelte icon name (see $lib/types/entities AREA_ICON_KEYS).
  icon            text not null default 'Building2',
  -- accent color, hex (#rrggbb). Drives the node color in the graph.
  color           text not null default '#6366f1',
  sort_order      integer not null default 0,
  agent_ids       text[] not null default '{}',
  user_ids        uuid[] not null default '{}',
  skill_keys      text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- One area slug per org (lets the UI key areas by a stable human slug).
create unique index if not exists org_areas_org_slug_uniq
  on public.org_areas (organization_id, slug);

create index if not exists org_areas_org_idx
  on public.org_areas (organization_id, sort_order);

alter table public.org_areas enable row level security;
alter table public.org_areas force row level security;

-- Members of an org may READ its areas (the graph is a read surface for the
-- whole team). Writes go through the hub service role, which bypasses RLS, so
-- no write policy is needed — admin gating happens in the API layer.
drop policy if exists org_areas_member_read on public.org_areas;
create policy org_areas_member_read on public.org_areas
  for select
  using (
    organization_id in (
      select organization_id
      from public.organization_members
      where profile_id = auth.uid()
    )
  );

comment on table public.org_areas is
  'Org areas (departments). Groups agents/users/skills per organization for the OVERVIEW graph. Member-read RLS; hub service-role writes.';
