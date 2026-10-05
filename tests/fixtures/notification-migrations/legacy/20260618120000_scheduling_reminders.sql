-- Autonomous Reminders Agent (Scheduling R2). Per-org config + send-log.
-- Tenancy: org_id text, enforced by the app_ledger role + app.current_org_id GUC
-- (same as sched_* / fin_* / crm_*). Idempotent: CREATE ... IF NOT EXISTS.

-- ── sched_reminder_config ─────────────────────────────────────────────────────
create table if not exists public.sched_reminder_config (
  org_id      text primary key,
  enabled     boolean not null default false,
  stages      jsonb not null default '[{"key":"confirmation"},{"key":"24h","minutesBefore":1440},{"key":"2h","minutesBefore":120}]'::jsonb,
  channel     text not null default 'whatsapp',
  account_id  text,
  personalize boolean not null default true,
  locale      text not null default 'es',
  from_name   text,
  updated_at  timestamptz not null default now()
);
--> statement-breakpoint

-- ── sched_reminders ───────────────────────────────────────────────────────────
create table if not exists public.sched_reminders (
  id         uuid primary key default gen_random_uuid(),
  org_id     text not null,
  booking_id uuid not null references public.sched_bookings(id) on delete cascade,
  stage      text not null,
  channel    text not null,
  recipient  text,
  content    text,
  status     text not null,
  message_id text,
  error      text,
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists sched_reminders_booking_stage_uniq
  on public.sched_reminders (org_id, booking_id, stage);
--> statement-breakpoint
create index if not exists sched_reminders_org_created_idx on public.sched_reminders (org_id, created_at);
--> statement-breakpoint
create index if not exists sched_reminders_booking_idx on public.sched_reminders (booking_id);
--> statement-breakpoint

-- ── RLS ───────────────────────────────────────────────────────────────────────
grant select, insert, update, delete on public.sched_reminder_config to app_ledger;
--> statement-breakpoint
grant select, insert, update, delete on public.sched_reminders       to app_ledger;
--> statement-breakpoint

alter table public.sched_reminder_config enable row level security;
--> statement-breakpoint
alter table public.sched_reminder_config force  row level security;
--> statement-breakpoint
alter table public.sched_reminders       enable row level security;
--> statement-breakpoint
alter table public.sched_reminders       force  row level security;
--> statement-breakpoint

create policy sched_reminder_config_org_guc on public.sched_reminder_config
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
create policy sched_reminders_org_guc on public.sched_reminders
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
