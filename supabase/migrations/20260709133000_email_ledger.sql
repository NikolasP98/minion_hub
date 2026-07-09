-- Email ledger: a privacy-minded record of each PROCESSED email (one the
-- auto-labeler touched). Stores ONLY derived + metadata — the AI summary, the
-- applied label names, the sender DOMAIN (not the full address), and the
-- subject. It NEVER stores the body, snippet, or attachments.
--
-- Compliance posture:
--   * data minimization — no content beyond subject + a one-line summary;
--   * storage limitation — every row carries expires_at; the purge tick deletes
--     expired rows (retention configurable per org, default 180 days);
--   * right to erasure — org+user scoped, so deletion is a scoped DELETE;
--   * access control — org RLS (app_ledger role + app.current_org_id GUC).
-- Drizzle schema: src/server/db/pg-schema/email-ledger.ts

create table if not exists public.email_ledger (
  id                uuid primary key default gen_random_uuid(),
  org_id            text not null,
  user_id           text,                       -- owner of the mailbox (erasure scope)
  mailbox           text not null,              -- watched account, e.g. admin@facesculptors.net
  gmail_message_id  text not null,
  from_domain       text,                       -- sender DOMAIN only (data-min)
  subject           text,
  summary           text,                       -- AI one-liner (derived)
  labels            text[] not null default '{}',
  processed_at      timestamptz not null default now(),
  expires_at        timestamptz,                -- retention horizon; null = keep
  unique (mailbox, gmail_message_id)
);

create index if not exists email_ledger_org_processed_idx
  on public.email_ledger (org_id, processed_at desc);
create index if not exists email_ledger_expires_idx
  on public.email_ledger (expires_at);

alter table public.email_ledger enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='email_ledger' and policyname='email_ledger_org') then
    create policy email_ledger_org on public.email_ledger
      using (org_id = current_setting('app.current_org_id', true))
      with check (org_id = current_setting('app.current_org_id', true));
  end if;
end $$;
grant select, insert, update, delete on public.email_ledger to app_ledger;

-- Per-org retention config (days). Default 180; editable from /channels/gmail.
create table if not exists public.email_ledger_settings (
  org_id          text primary key,
  retention_days  integer not null default 180,
  updated_at      timestamptz not null default now()
);

alter table public.email_ledger_settings enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='email_ledger_settings' and policyname='email_ledger_settings_org') then
    create policy email_ledger_settings_org on public.email_ledger_settings
      using (org_id = current_setting('app.current_org_id', true))
      with check (org_id = current_setting('app.current_org_id', true));
  end if;
end $$;
grant select, insert, update, delete on public.email_ledger_settings to app_ledger;
