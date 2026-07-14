-- Link a Hub-authored agent draft to its deployed gateway/runtime agent.
-- Runtime agents live outside Postgres, so this is intentionally nullable and
-- has no foreign key. Deleting a draft must never imply runtime deletion.
alter table public.built_agents
  add column if not exists runtime_agent_id text;

create index if not exists idx_built_agents_runtime_agent
  on public.built_agents (runtime_agent_id)
  where runtime_agent_id is not null;
