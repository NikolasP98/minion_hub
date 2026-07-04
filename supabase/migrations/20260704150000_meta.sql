-- Meta (Facebook/Instagram) Business integration. See
-- specs/2026-07-04-meta-business-integration.md §3 (frozen contract).
--
-- Five tables: meta_connections (per-org FLB/system-user token), meta_assets
-- (org↔page/ig/ad_account bridge), meta_post_insights (post/media metric
-- facts), meta_ad_insights (daily ad-level facts), meta_sync_jobs (clone of
-- fin_sync_jobs). Tenancy: org_id text + the app_ledger role +
-- app.current_org_id GUC (withOrgCore), same as finance/stock/party.
-- Idempotent.

-- ── meta_connections ─────────────────────────────────────────────────────────
create table if not exists public.meta_connections (
  id                uuid primary key default gen_random_uuid(),
  org_id            text not null,
  kind              text not null,                    -- 'flb'|'system_user'
  fb_user_id        text,
  token_ciphertext  text,
  token_iv          text,
  token_expires_at  timestamptz,
  granted_scopes    jsonb not null default '[]'::jsonb,
  status            text not null default 'active',   -- active|expiring|expired|revoked
  connected_by      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists meta_connections_org_kind_fbuser_uniq
  on public.meta_connections (org_id, kind, fb_user_id);
--> statement-breakpoint
create index if not exists meta_connections_org_idx on public.meta_connections (org_id);
--> statement-breakpoint

-- ── meta_assets (org ↔ page/ig/ad_account bridge) ───────────────────────────
create table if not exists public.meta_assets (
  id                       uuid primary key default gen_random_uuid(),
  org_id                   text not null,
  connection_id            uuid not null references public.meta_connections (id) on delete cascade,
  kind                     text not null,              -- 'page'|'ig'|'ad_account'
  external_id              text not null,
  name                     text,
  page_token_ciphertext    text,
  page_token_iv            text,
  parent_page_id           text,                        -- for ig assets
  currency                 text,                        -- for ad_account assets
  enabled                  boolean not null default true,
  meta                     jsonb not null default '{}'::jsonb,
  created_at               timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists meta_assets_org_kind_ext_uniq
  on public.meta_assets (org_id, kind, external_id);
--> statement-breakpoint
create index if not exists meta_assets_connection_idx on public.meta_assets (connection_id);
--> statement-breakpoint

-- ── meta_post_insights (post/media metric facts) ────────────────────────────
create table if not exists public.meta_post_insights (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  asset_id    uuid not null references public.meta_assets (id) on delete cascade,
  platform    text not null,                           -- 'fb'|'ig'
  post_id     text not null,
  permalink   text,
  caption     text,
  media_type  text,
  posted_at   timestamptz,
  metric      text not null,
  value       numeric,
  period      text not null default 'lifetime',
  fetched_at  timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists meta_post_insights_org_post_metric_period_uniq
  on public.meta_post_insights (org_id, post_id, metric, period);
--> statement-breakpoint
create index if not exists meta_post_insights_asset_idx on public.meta_post_insights (asset_id);
--> statement-breakpoint

-- ── meta_ad_insights (daily ad-level facts) ─────────────────────────────────
create table if not exists public.meta_ad_insights (
  id             uuid primary key default gen_random_uuid(),
  org_id         text not null,
  ad_account_id  text not null,
  campaign_id    text,
  campaign_name  text,
  adset_id       text,
  adset_name     text,
  ad_id          text not null,
  ad_name        text,
  date           date not null,
  spend          numeric,
  impressions    integer,
  reach          integer,
  clicks         integer,
  ctr            numeric,
  cpc            numeric,
  actions        jsonb not null default '[]'::jsonb,
  currency       text,
  fetched_at     timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists meta_ad_insights_org_ad_date_uniq
  on public.meta_ad_insights (org_id, ad_id, date);
--> statement-breakpoint
create index if not exists meta_ad_insights_org_account_date_idx
  on public.meta_ad_insights (org_id, ad_account_id, date);
--> statement-breakpoint

-- ── meta_sync_jobs (clone of fin_sync_jobs) ─────────────────────────────────
create table if not exists public.meta_sync_jobs (
  id           uuid primary key default gen_random_uuid(),
  org_id       text not null,
  kind         text not null,                          -- posts|ads|messages
  status       text not null default 'queued',          -- queued|running|succeeded|failed|cancelled
  page_cursor  text,
  since        date,
  until        date,
  counts       jsonb not null default '{}'::jsonb,
  error        text,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists meta_sync_jobs_active_uq
  on public.meta_sync_jobs (org_id, kind) where status in ('queued','running');
--> statement-breakpoint
create index if not exists meta_sync_jobs_org_kind_created_idx
  on public.meta_sync_jobs (org_id, kind, created_at);
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors stock/party) ──
grant select, insert, update, delete on public.meta_connections   to app_ledger;
--> statement-breakpoint
grant select, insert, update, delete on public.meta_assets        to app_ledger;
--> statement-breakpoint
grant select, insert, update, delete on public.meta_post_insights to app_ledger;
--> statement-breakpoint
grant select, insert, update, delete on public.meta_ad_insights   to app_ledger;
--> statement-breakpoint
grant select, insert, update, delete on public.meta_sync_jobs     to app_ledger;
--> statement-breakpoint

alter table public.meta_connections   enable row level security;
--> statement-breakpoint
alter table public.meta_connections   force  row level security;
--> statement-breakpoint
alter table public.meta_assets        enable row level security;
--> statement-breakpoint
alter table public.meta_assets        force  row level security;
--> statement-breakpoint
alter table public.meta_post_insights enable row level security;
--> statement-breakpoint
alter table public.meta_post_insights force  row level security;
--> statement-breakpoint
alter table public.meta_ad_insights   enable row level security;
--> statement-breakpoint
alter table public.meta_ad_insights   force  row level security;
--> statement-breakpoint
alter table public.meta_sync_jobs     enable row level security;
--> statement-breakpoint
alter table public.meta_sync_jobs     force  row level security;
--> statement-breakpoint

create policy meta_connections_org_guc on public.meta_connections
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
create policy meta_assets_org_guc on public.meta_assets
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
create policy meta_post_insights_org_guc on public.meta_post_insights
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
create policy meta_ad_insights_org_guc on public.meta_ad_insights
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
create policy meta_sync_jobs_org_guc on public.meta_sync_jobs
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
