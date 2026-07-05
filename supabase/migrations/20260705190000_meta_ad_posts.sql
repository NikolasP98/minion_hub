-- meta_ad_posts: one row per (org, ad), persists which organic post an ad is
-- running as (ad_id -> post_id, discovered from the ad creative's
-- effective_object_story_id). Distinct from meta_ad_insights (one row per
-- ad×date) — the link is per-ad, not per-day. Tenancy: org_id text + the
-- app_ledger role + app.current_org_id GUC, same as the other meta_* tables
-- (companion migration 20260704150000_meta.sql). See
-- specs/2026-07-05-socials-rename-detail-pages.md §3. Idempotent.

create table if not exists public.meta_ad_posts (
  org_id      text not null,
  ad_id       text not null,
  post_id     text not null,
  platform    text not null default 'fb',
  updated_at  timestamptz not null default now(),
  primary key (org_id, ad_id)
);
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors meta_*) ───────
grant select, insert, update, delete on public.meta_ad_posts to app_ledger;
--> statement-breakpoint

alter table public.meta_ad_posts enable row level security;
--> statement-breakpoint
alter table public.meta_ad_posts force  row level security;
--> statement-breakpoint

create policy meta_ad_posts_org_guc on public.meta_ad_posts
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
