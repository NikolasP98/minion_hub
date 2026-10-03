-- Generic notification rules (ERPNext Notification port). Event-driven alerts
-- over any allowlisted entity; delivery via the gateway channels.send path.
-- notif_log unique (rule, entity, trigger_key) = dedup + audit. org-scoped RLS.

create table if not exists public.notif_rules (
  id               uuid primary key default gen_random_uuid(),
  org_id           text not null,
  name             text not null,
  enabled          boolean not null default true,
  trigger_table    text not null,
  trigger_event    text not null,           -- insert | update | date_offset
  date_field       text,
  date_offset_mins integer,
  condition        jsonb not null default '[]'::jsonb,
  recipients       jsonb not null default '[]'::jsonb,
  channel          text not null,
  account_id       text,
  template         text not null,
  last_run_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
--> statement-breakpoint
create index if not exists notif_rules_org_idx on public.notif_rules (org_id);
--> statement-breakpoint

create table if not exists public.notif_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  rule_id     uuid not null,
  entity_id   text not null,
  trigger_key text not null,
  channel     text not null,
  recipient   text,
  content     text,
  status      text not null,
  error       text,
  message_id  text,
  created_at  timestamptz not null default now()
);
--> statement-breakpoint
create unique index if not exists notif_log_rule_entity_key_uniq on public.notif_log (rule_id, entity_id, trigger_key);
--> statement-breakpoint
create index if not exists notif_log_org_idx on public.notif_log (org_id, created_at);
--> statement-breakpoint

grant select, insert, update, delete on public.notif_rules to app_ledger;
--> statement-breakpoint
grant select, insert on public.notif_log to app_ledger;
--> statement-breakpoint
alter table public.notif_rules enable row level security;
--> statement-breakpoint
alter table public.notif_rules force  row level security;
--> statement-breakpoint
alter table public.notif_log   enable row level security;
--> statement-breakpoint
alter table public.notif_log   force  row level security;
--> statement-breakpoint
create policy notif_rules_org_guc on public.notif_rules
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
create policy notif_log_org_guc on public.notif_log
  for all using (org_id = current_setting('app.current_org_id', true))
          with check (org_id = current_setting('app.current_org_id', true));
--> statement-breakpoint
