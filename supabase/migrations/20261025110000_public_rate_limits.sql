-- Spec 041 Amendment A, F2 item 16: a rate limit shared by every hub instance.
-- The in-memory limiter (src/server/auth/rate-limit.ts) counts per Vercel
-- lambda, so N warm instances allowed N x the limit. One row per bucket, a
-- fixed window reset in place. `bucket` is a SHA-256 hex of the caller's key
-- (visitor IP + door), so no IP address is ever stored.
create table if not exists public.public_rate_limits (
  bucket       text primary key check (bucket ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null default now(),
  hits         integer not null default 1 check (hits >= 1)
);
create index if not exists public_rate_limits_window_idx
  on public.public_rate_limits (window_start);

alter table public.public_rate_limits enable row level security;
alter table public.public_rate_limits force row level security;
-- No policies: only the hub's core (RLS-bypassing) connection reads/writes it,
-- before any org is known. anon/authenticated see nothing through PostgREST.

comment on table public.public_rate_limits is
  'Shared fixed-window counters for unauthenticated hub endpoints (hashed keys only). Hub core role only.';
