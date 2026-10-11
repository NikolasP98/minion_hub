-- App changelog as an SDLC artifact (spec 2026-10-10-hub-inbox-notifications-reminders,
-- Slice 3). One row per published hub release; the GitHub Action
-- (.github/workflows/release-notes.yml) POSTs here after it tags a release.
-- `POST /api/releases` also creates the ONE `scope: global` `app.update`
-- notification every signed-in user sees (app_notifications, Slice 1).
--
-- Global data, no tenant dimension — unlike app_notifications there is no
-- org_id to scope on, so the RLS policy is a flat `true` (any app_ledger
-- session may read/write; the write path is gated upstream by the route's
-- own CRON_SECRET bearer check, same as the other cron-auth routes).

create table if not exists public.app_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  released_at timestamptz not null,
  sections jsonb not null default '{}'::jsonb,
  prs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
--> statement-breakpoint

create index if not exists app_releases_released_at_idx
  on public.app_releases (released_at desc);
--> statement-breakpoint

grant select, insert, update, delete on public.app_releases to app_ledger;
--> statement-breakpoint

alter table public.app_releases enable row level security;
--> statement-breakpoint
alter table public.app_releases force row level security;
--> statement-breakpoint

create policy app_releases_readable_by_any_member on public.app_releases
  for all using (true) with check (true);
