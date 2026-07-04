-- P4.1 AI-Brains managed agents — one org-level template that provisions/
-- reconfigures every brain's managing gateway agent (archetype 'brain').
--
-- Mirrors the brains migration's org_guc RLS shape exactly (role app_ledger +
-- app.current_org_id GUC — see with-org-core.ts / 20260702120000_brains.sql).

create table if not exists public.brain_agent_templates (
  id uuid primary key default gen_random_uuid(),
  org_id text not null unique,
  name_prefix text not null default 'Brain',
  emoji text,
  model text,
  instructions text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.brains add column if not exists agent_id text;

-- ── RLS (org_guc — role app_ledger + app.current_org_id GUC) ────────────────

alter table public.brain_agent_templates enable row level security;
alter table public.brain_agent_templates force row level security;
drop policy if exists brain_agent_templates_org_guc on public.brain_agent_templates;
create policy brain_agent_templates_org_guc on public.brain_agent_templates
  for all
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));

-- app_ledger is the non-bypass role withOrgCore SET LOCAL ROLEs into inside the
-- txn (see with-org-core.ts) — needs explicit table grants, same as `brains`.
grant select, insert, update, delete on public.brain_agent_templates to app_ledger;

comment on table public.brain_agent_templates is
  'Org-level template (one row per org) for provisioning/reconfiguring every brain''s managing gateway agent (P4.1 AI-Brains).';
comment on column public.brains.agent_id is
  'Gateway agentId (pattern brain-<brainUuid>) of this brain''s managing agent, or null if agent management is disabled for this brain.';
