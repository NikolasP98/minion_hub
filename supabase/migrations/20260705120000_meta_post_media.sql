-- meta_post_media: one row per post, mirrors the Meta CDN thumbnail into our
-- own bucket (file.service category meta/<platform>). Distinct from
-- meta_post_insights (long/narrow, one row per post×metric×period) — a
-- thumbnail belongs to the post, not a metric. Tenancy: org_id text + the
-- app_ledger role + app.current_org_id GUC, same as the other meta_* tables
-- (companion migration 20260704150000_meta.sql). See
-- specs/2026-07-05-meta-post-thumbnail-mirroring.md §4. Idempotent.

create table if not exists public.meta_post_media (
  org_id      text not null,
  platform    text not null,                          -- 'fb'|'ig'
  post_id     text not null,
  file_id     text,                                    -- -> public.files.id (null until mirrored)
  source_url  text,                                    -- last CDN url mirrored from (audit/debug — expires, never re-served)
  media_type  text,                                    -- IMAGE|VIDEO|CAROUSEL_ALBUM|REELS (IG) / FB type
  status      text not null default 'pending',         -- pending|mirrored|failed|skipped
  error       text,
  attempts    integer not null default 0,
  fetched_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (org_id, platform, post_id)
);
--> statement-breakpoint
create index if not exists meta_post_media_org_status_idx
  on public.meta_post_media (org_id, status);
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors meta_*) ───────
grant select, insert, update, delete on public.meta_post_media to app_ledger;
--> statement-breakpoint

alter table public.meta_post_media enable row level security;
--> statement-breakpoint
alter table public.meta_post_media force  row level security;
--> statement-breakpoint

create policy meta_post_media_org_guc on public.meta_post_media
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
