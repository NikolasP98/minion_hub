-- Spec 143: sign in to the hub's MCP endpoint. The hub issues opaque credentials itself;
-- only their SHA-256 hex is stored. All three tables are reached only through the privileged
-- core handle (every lookup happens before an organization is known): forced row security with
-- no policy and no grant leaves the data API roles nothing.

create table if not exists public.mcp_clients (
  id            text primary key,                -- 'mcpc_' + 24 url-safe characters
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 5),
  created_at    timestamptz not null default now(),
  created_ip    text
);

create table if not exists public.mcp_connections (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,                    -- profile id (== Supabase user id)
  client_id    text not null references public.mcp_clients (id) on delete cascade,
  org_id       text not null,
  member_since timestamptz not null,             -- organization_members.created_at at approval: a re-added member is a new membership
  approved_at  timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid
);
create index if not exists mcp_connections_org_live_idx
  on public.mcp_connections (org_id) where revoked_at is null;
create index if not exists mcp_connections_user_live_idx
  on public.mcp_connections (user_id) where revoked_at is null;

create table if not exists public.mcp_credentials (
  hash           text primary key,               -- sha256 hex of the secret
  kind           text not null check (kind in ('code', 'access', 'refresh')),
  connection_id  uuid references public.mcp_connections (id) on delete cascade, -- null for a code
  client_id      text not null references public.mcp_clients (id) on delete cascade,
  user_id        uuid not null,
  org_id         text not null,
  redirect_uri   text,                           -- code only
  code_challenge text,                           -- code only
  expires_at     timestamptz not null,
  used_at        timestamptz,
  regranted_at   timestamptz,                   -- renewal only: the one grace reissue (spec 143 P2)
  created_at     timestamptz not null default now()
);
create index if not exists mcp_credentials_connection_idx
  on public.mcp_credentials (connection_id);

alter table public.mcp_clients enable row level security;
alter table public.mcp_clients force row level security;
alter table public.mcp_connections enable row level security;
alter table public.mcp_connections force row level security;
alter table public.mcp_credentials enable row level security;
alter table public.mcp_credentials force row level security;
revoke all on public.mcp_clients, public.mcp_connections, public.mcp_credentials
  from public, anon, authenticated;
