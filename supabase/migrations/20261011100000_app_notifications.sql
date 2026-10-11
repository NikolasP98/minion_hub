-- In-app inbox with scope tiers (spec 2026-10-10-hub-inbox-notifications-reminders,
-- Slice 1). One row per notification, one scope tier per row — the reader's feed
-- is resolved at READ time (org membership + role capability + user id), never
-- fanned out per recipient. `app_notification_reads` is the per-user read/dismiss
-- state; it never deletes the notification (I3).
--
-- This is the table the S5 event platform's `inbox.v1` projection (see
-- src/server/services/notifications/README.md) was waiting for — that worker is
-- NOT touched here (I5); it will write `kind = 'event.*'` rows into this same
-- table once enabled.

create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('global', 'org', 'role', 'user')),
  org_id text null,
  capability text null,
  profile_id uuid null,
  kind text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title text not null,
  body text null,
  href text null,
  subject_type text null,
  subject_id text null,
  dedupe_key text null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  resolved_at timestamptz null,
  -- Exactly the fields the scope declares — global has none, org only org_id,
  -- role adds a capability key, user adds a profile id.
  constraint app_notifications_scope_shape check (
    (scope = 'global' and org_id is null and capability is null and profile_id is null)
    or (scope = 'org' and org_id is not null and capability is null and profile_id is null)
    or (scope = 'role' and org_id is not null and capability is not null and profile_id is null)
    or (scope = 'user' and org_id is not null and capability is null and profile_id is not null)
  )
);
--> statement-breakpoint

create unique index if not exists app_notifications_dedupe_key_uniq
  on public.app_notifications (dedupe_key)
  where dedupe_key is not null;
--> statement-breakpoint

-- Feed listing: newest first within a tier.
create index if not exists app_notifications_scope_org_created_idx
  on public.app_notifications (scope, org_id, created_at desc);
--> statement-breakpoint

-- User-scope lookups (markRead/dismiss target resolution, user-tier feed).
create index if not exists app_notifications_profile_idx
  on public.app_notifications (profile_id)
  where profile_id is not null;
--> statement-breakpoint

-- The default feed hides resolved rows (I2) — this is the hot-path filter.
create index if not exists app_notifications_unresolved_idx
  on public.app_notifications (resolved_at)
  where resolved_at is null;
--> statement-breakpoint

create table if not exists public.app_notification_reads (
  profile_id uuid not null,
  notification_id uuid not null references public.app_notifications (id) on delete cascade,
  read_at timestamptz null,
  dismissed_at timestamptz null,
  primary key (profile_id, notification_id)
);
--> statement-breakpoint

create index if not exists app_notification_reads_notification_idx
  on public.app_notification_reads (notification_id);
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors stk_*/party). ──
-- Global rows (org_id null) are readable by any signed-in member regardless of
-- their active org — role/user-tier filtering within an org happens in the
-- service layer (inbox.service.ts), which already runs inside the org-scoped
-- transaction, so a role/user row from another org is already excluded by the
-- `org_id` branch below before capability/profile matching ever runs.
grant select, insert, update, delete on public.app_notifications to app_ledger;
--> statement-breakpoint
grant select, insert, update, delete on public.app_notification_reads to app_ledger;
--> statement-breakpoint

alter table public.app_notifications enable row level security;
--> statement-breakpoint
alter table public.app_notifications force row level security;
--> statement-breakpoint
alter table public.app_notification_reads enable row level security;
--> statement-breakpoint
alter table public.app_notification_reads force row level security;
--> statement-breakpoint

create policy app_notifications_org_guc on public.app_notifications
  for all using (
    org_id is null or org_id = current_setting('app.current_org_id', true)
  )
  with check (
    org_id is null or org_id = current_setting('app.current_org_id', true)
  );
--> statement-breakpoint

-- Read/dismiss state is per profile, not per org — gate on the profile GUC
-- that withOrgCore already sets for record-level (if-owner) scoping.
create policy app_notification_reads_profile_guc on public.app_notification_reads
  for all using (
    profile_id::text = current_setting('app.current_profile_id', true)
  )
  with check (
    profile_id::text = current_setting('app.current_profile_id', true)
  );
