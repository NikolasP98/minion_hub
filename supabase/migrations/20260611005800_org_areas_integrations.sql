-- org_areas v2 — integrations layer + provisioned (virtual) agents.
--
-- `integration_keys` are keys into the client-side INTEGRATIONS registry
-- ($lib/types/entities) — third-party platforms (Meta Ads, Instagram, Google
-- Sheets, …) that the area's skills/agents operate through. Rendered as a
-- branded-icon ring between skills and agents in the OVERVIEW graph.
--
-- `virtual_agents` are provisioned single-function agents that don't exist on
-- the gateway (yet) — each one a narrow end-to-end function (copywriter, KPI
-- analyst, invoice processor). Shape per entry:
--   { id, name, role, skillKeys: string[], integrationKeys: string[] }

alter table public.org_areas
  add column if not exists integration_keys text[] not null default '{}',
  add column if not exists virtual_agents   jsonb  not null default '[]';

comment on column public.org_areas.integration_keys is
  'Keys into the hub INTEGRATIONS registry (branded third-party platforms used by this area).';
comment on column public.org_areas.virtual_agents is
  'Provisioned single-function agents: [{id,name,role,skillKeys,integrationKeys}].';
