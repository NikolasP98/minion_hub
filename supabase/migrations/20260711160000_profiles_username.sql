-- Login username for password auth (distinct from `alias`, the chat @mention handle).
-- Stored lowercase; format enforced app-side (normalizeUsername).
alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_key on public.profiles (username);
