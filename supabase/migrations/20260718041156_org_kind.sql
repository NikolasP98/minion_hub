alter table public.organizations
  add column if not exists kind text not null default 'business'
    check (kind in ('business','personal'));
