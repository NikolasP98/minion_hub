-- Per-call LLM usage ledger. The hub had NO usage/quota/credit/billing table
-- anywhere before this, so per-tenant AI cost was unmeasurable and no price
-- could be defended. Written by the usage middleware in `src/server/llm.ts`,
-- which every LLM call in the hub funnels through.
--
-- No FK to organizations ON DELETE CASCADE on purpose: usage rows must outlive
-- the tenant they describe, or deleting an org erases its own last invoice.
-- `org_id` is text to match `messages.org_id` and the crm_* tables.
--
-- RLS enabled + forced with NO policies (deny-all for every non-bypass role):
-- read exclusively by the service role from admin-gated cost dashboards and
-- billing rollups. Never exposed to a tenant-scoped RLS session.
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  org_id text,
  route text,
  feature text,
  model text not null,

  input_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  output_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,

  -- Our estimate from the local price table (may go stale).
  cost_usd double precision not null default 0,
  -- Provider-reported actual cost when available. Authoritative over cost_usd.
  provider_cost_usd double precision,

  duration_ms integer,
  ok boolean not null default true,
  created_at timestamptz not null default now()
);

-- Billing rollup: "what did org X cost me over this period".
create index if not exists ai_usage_org_created_idx on public.ai_usage (org_id, created_at);
-- Runaway/abuse sweep: "what is burning money right now", across all tenants.
create index if not exists ai_usage_created_idx on public.ai_usage (created_at);

alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;
