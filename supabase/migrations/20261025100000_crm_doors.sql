-- Spec 041 (hub collection points / "doors"), S0 foundation. ALL door schema for
-- S0–S6 lands here so later slices carry no migration (contracts/data-model.md).
-- Tables are inert until their slice ships. Booking links stay in sched_links.

-- 1. Doors (form | faq | offer).
create table if not exists public.crm_doors (
  id          uuid primary key default gen_random_uuid(),
  org_id      text not null,
  kind        text not null check (kind in ('form','faq','offer')),
  slug        text not null check (slug ~ '^[a-z0-9][a-z0-9-]{2,62}$'),
  title       text not null check (length(title) between 1 and 200),
  description text check (description is null or length(description) <= 2000),
  active      boolean not null default false,
  config      jsonb not null default '{}'::jsonb,
  follow_up   jsonb,                      -- S4: {enabled, delayMinutes, accountId, template}
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Global namespace for /d/<slug> (avoids the per-org ambiguity of /book, R11).
create unique index if not exists crm_doors_slug_uniq on public.crm_doors (slug);
create index if not exists crm_doors_org_idx on public.crm_doors (org_id, kind);

-- 2. Form submissions (personal, possibly clinical data). No delete path: doors
--    are switched off, never deleted (FK on delete restrict).
create table if not exists public.crm_door_submissions (
  id           uuid primary key default gen_random_uuid(),
  org_id       text not null,
  door_id      uuid not null references public.crm_doors(id) on delete restrict,
  contact_id   uuid,                      -- soft ref crm_contacts.id (null if no phone/email)
  payload      jsonb not null,            -- {fieldKey: value} after server validation
  consent      boolean not null default false,
  consent_text text,                      -- snapshot of the text the visitor agreed to
  attribution  jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists crm_door_submissions_door_idx on public.crm_door_submissions (org_id, door_id, created_at desc);
create index if not exists crm_door_submissions_contact_idx on public.crm_door_submissions (org_id, contact_id);

-- 3. Follow-up claims (one per door+contact, ever).
create table if not exists public.crm_door_followups (
  id            uuid primary key default gen_random_uuid(),
  org_id        text not null,
  door_id       uuid not null references public.crm_doors(id) on delete restrict,
  contact_id    uuid not null,
  submission_id uuid not null references public.crm_door_submissions(id) on delete restrict,
  status        text not null check (status in ('sending','sent','failed','skipped')),
  reason        text,                     -- skipped: opted_out|bought|replied|no_consent|no_identity
  recipient     text,                     -- E.164, for audit
  content       text,
  message_id    text,
  error         text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (org_id, door_id, contact_id)
);

-- 4. Anonymous daily counters. door_key = 'book:<sched_links.id>' | 'door:<crm_doors.id>'.
--    No IP, user agent or PII — ever.
create table if not exists public.crm_door_stats_daily (
  org_id      text not null,
  door_key    text not null,
  day         date not null,
  views       integer not null default 0,
  submissions integer not null default 0,
  primary key (org_id, door_key, day)
);

-- 5. First touch on the contact (set once, by the door that created it).
alter table public.crm_contacts add column if not exists first_touch jsonb;
create index if not exists crm_contacts_first_touch_door_idx
  on public.crm_contacts (org_id, (first_touch->>'door')) where first_touch is not null;

-- RLS for 1–4: enable + force + <table>_org_guc policy + grant to app_ledger
-- (convention: 20260717170000_meta_lead_attribution.sql).
do $$
declare t text;
begin
  foreach t in array array['crm_doors','crm_door_submissions','crm_door_followups','crm_door_stats_daily'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_org_guc') then
      execute format(
        'create policy %I on public.%I using (org_id = current_setting(''app.current_org_id'', true)) with check (org_id = current_setting(''app.current_org_id'', true))',
        t || '_org_guc', t);
    end if;
    execute format('grant select, insert, update, delete on public.%I to app_ledger', t);
  end loop;
end $$;
