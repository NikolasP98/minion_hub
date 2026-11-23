-- Spec 147: "Cerrar agenda" — stretches of time nobody should book, with a reason.
-- One row per local day; rows created by one action share `group_id`.
-- A closure is org-wide: the whole agenda, every resource.
create table if not exists public.sched_closures (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  group_id uuid not null,
  created_by text,
  created_at timestamptz not null default now(),
  constraint sched_closures_range_chk check (ends_at > starts_at),
  constraint sched_closures_reason_chk check (char_length(reason) between 1 and 120)
);
--> statement-breakpoint
create index if not exists sched_closures_org_start_idx
  on public.sched_closures (org_id, starts_at);
--> statement-breakpoint
create index if not exists sched_closures_group_idx
  on public.sched_closures (org_id, group_id);
--> statement-breakpoint

-- ── RLS: org isolation via the app_ledger role + GUC (mirrors every other sched_* table) ──
grant select, insert, update, delete on public.sched_closures to app_ledger;
--> statement-breakpoint
alter table public.sched_closures enable row level security;
--> statement-breakpoint
alter table public.sched_closures force row level security;
--> statement-breakpoint
drop policy if exists sched_closures_org_guc on public.sched_closures;
--> statement-breakpoint
create policy sched_closures_org_guc on public.sched_closures
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
