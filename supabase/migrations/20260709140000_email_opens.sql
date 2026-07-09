-- Cross-device "opened in the hub" state for feed emails. Personal, per-user
-- (NOT org data): a row means "this user opened this Gmail message in the hub".
-- Deliberately separate from Gmail's read/unread — opening here never touches
-- Gmail. Code-scoped by user_id via getCoreDb() (same pattern as `notes`), so
-- no RLS/GUC — every query filters user_id explicitly.
-- Drizzle schema: src/server/db/pg-schema/email-opens.ts

create table if not exists public.email_opens (
  user_id           text not null,
  gmail_message_id  text not null,
  opened_at         timestamptz not null default now(),
  primary key (user_id, gmail_message_id)
);

create index if not exists email_opens_user_idx on public.email_opens (user_id, opened_at desc);
