-- pending_channel_claims — hub-owned OTP / deep-link claim state.
--
-- The hub (not the gateway) owns the channel-claim lifecycle so claiming works
-- regardless of which gateway/extension is installed. This table is the durable,
-- central store for in-flight claims (the hub runs on Vercel serverless, so an
-- in-memory map or a local sqlite file would not survive across invocations).
--
-- Hardening:
--   * codes are stored HASHED (HMAC-SHA256), never plaintext
--   * partial unique index → no overlapping in-flight claim per (user, channel, target)
--   * last_sent_at         → 30s resend cooldown
--   * attempts/max_attempts → brute-force cap (6-digit space)
--   * expires_at           → TTL
--   * RLS forced, service-role only (hub uses the service key; the gateway never
--     touches this table directly)

create table if not exists public.pending_channel_claims (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  channel         text not null,                 -- 'whatsapp' | 'telegram'
  method          text not null default 'otp',   -- 'otp' | 'deeplink'
  channel_user_id text,                           -- E.164 digits / telegram id; null until a deeplink resolves
  display_name    text,
  code_hash       text,                           -- HMAC-SHA256 of the 6-digit code (otp only)
  start_token     text,                           -- opaque deep-link token (deeplink only)
  attempts        integer not null default 0,
  max_attempts    integer not null default 5,
  last_sent_at    timestamptz,
  expires_at      timestamptz not null,
  consumed_at     timestamptz,
  created_at      timestamptz not null default now()
);

-- One live claim per (user, channel, target). Consumed rows fall out of the
-- index (consumed_at is not null) so a re-claim inserts a fresh row and history
-- is retained for the per-user rate cap.
create unique index if not exists pending_claim_live_uniq
  on public.pending_channel_claims (user_id, channel, channel_user_id)
  where consumed_at is null and channel_user_id is not null;

create unique index if not exists pending_claim_token_uniq
  on public.pending_channel_claims (start_token)
  where start_token is not null;

create index if not exists pending_claim_user_idx
  on public.pending_channel_claims (user_id, created_at);

create index if not exists pending_claim_expires_idx
  on public.pending_channel_claims (expires_at);

alter table public.pending_channel_claims enable row level security;
alter table public.pending_channel_claims force row level security;
-- No policies: only the service role (which bypasses RLS) reads/writes this table.

comment on table public.pending_channel_claims is
  'Hub-owned in-flight channel claim state (OTP + deep-link). Service-role only.';
