-- Build channels (DEV/PRD) — spec 2026-07-19 §WP-C / §WP-F.
--
-- 1. gateway.channel: which BUILD channel a gateway row serves.
-- 2. gateway_uniq_url must go: a row is an ASSIGNMENT, not ownership, so two
--    orgs legitimately share one URL (MINION-prd and PINONITE-prd both point at
--    netcup/default; MINION-dev and PINONITE-dev both point at protopi).
--    Identity is (url, org_id, channel), not url.
-- 3. gateway_lease: the (org, channel) -> instance mutex. Single-writer per org
--    is a hard invariant (SQLite + Baileys WA sessions on a local volume), so
--    the assignment is PERSISTED, never inferred from a health check race.

alter table public.gateway
  add column if not exists channel text not null default 'prd';

alter table public.gateway
  drop constraint if exists gateway_channel_valid;
alter table public.gateway
  add constraint gateway_channel_valid check (channel in ('dev', 'prd'));

comment on column public.gateway.channel is
  'Build channel this gateway row serves: dev (protopi) | prd (netcup). An org may only select a channel it has a row for — enforced server-side, not in the UI.';

drop index if exists public.gateway_uniq_url;
create unique index if not exists gateway_uniq_url_org_channel
  on public.gateway (url, coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), channel);
create index if not exists gateway_org_channel_idx on public.gateway (org_id, channel);

-- (org, channel) -> exactly one instance. The PK is the mutex: acquisition is a
-- conditional upsert that only wins when the incumbent lease has expired, so two
-- instances can never hold the same (org, channel) concurrently.
create table if not exists public.gateway_lease (
  org_id uuid not null,
  channel text not null,
  gateway_id uuid not null references public.gateway(id) on delete cascade,
  acquired_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- Last successful REAL WS upgrade (not a /health 200 — the Cloudflare route
  -- served {"ok":true} for weeks while refusing upgrades). Null = never probed.
  last_healthy_at timestamptz,
  primary key (org_id, channel),
  constraint gateway_lease_channel_valid check (channel in ('dev', 'prd'))
);

comment on table public.gateway_lease is
  'Health-aware assignment lease. A human picks the CHANNEL; this table picks the INSTANCE, and every protocol (HTTP/RPC/WS) follows it. Failover flips the lease but does NOT move channel state (WhatsApp/Baileys sessions stay on the old host).';
