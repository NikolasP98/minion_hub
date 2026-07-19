alter table public.channels
  add column if not exists owner_profile_id uuid references public.profiles(id) on delete set null;
create index if not exists channels_owner_profile_idx on public.channels (owner_profile_id);
comment on column public.channels.owner_profile_id is
  'Set => account is USER-scoped (follows this person across orgs). Null => ORG-scoped via tenant_id.';
