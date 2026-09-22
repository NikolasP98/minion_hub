create table if not exists public.crm_contact_guardians (
  org_id text not null,
  ward_contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  guardian_contact_id uuid not null references public.crm_contacts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (org_id, ward_contact_id, guardian_contact_id),
  constraint crm_contact_guardians_not_self check (ward_contact_id <> guardian_contact_id)
);
create index if not exists crm_contact_guardians_guardian_idx on public.crm_contact_guardians(org_id, guardian_contact_id);
alter table public.crm_contact_guardians enable row level security;
alter table public.crm_contact_guardians force row level security;
drop policy if exists crm_contact_guardians_org_guc on public.crm_contact_guardians;
create policy crm_contact_guardians_org_guc on public.crm_contact_guardians
  using (org_id = current_setting('app.current_org_id', true))
  with check (org_id = current_setting('app.current_org_id', true));
grant select, insert, update, delete on public.crm_contact_guardians to app_ledger;

create or replace function public.enforce_crm_guardian_eligibility()
returns trigger language plpgsql as $$
declare guardian_party uuid; ward_party uuid;
begin
  select c.party_id into guardian_party from public.crm_contacts c
    join public.parties p on p.id = c.party_id and p.org_id = c.org_id
    where c.id = new.guardian_contact_id and c.org_id = new.org_id and c.deleted_at is null
      and p.type = 'person' and p.dob <= current_date - interval '18 years'
    for update of p;
  select c.party_id into ward_party from public.crm_contacts c
    where c.id = new.ward_contact_id and c.org_id = new.org_id and c.deleted_at is null;
  if guardian_party is null or ward_party is null or guardian_party = ward_party then
    raise exception 'guardian must be a distinct adult person contact in the same organization';
  end if;
  return new;
end $$;
drop trigger if exists crm_guardian_eligibility on public.crm_contact_guardians;
create trigger crm_guardian_eligibility before insert or update on public.crm_contact_guardians
for each row execute function public.enforce_crm_guardian_eligibility();

create or replace function public.preserve_crm_guardian_adulthood()
returns trigger language plpgsql as $$
begin
  if (new.dob is null or new.dob > current_date - interval '18 years') and exists (
    select 1 from public.crm_contacts c join public.crm_contact_guardians cg
      on cg.org_id = c.org_id and cg.guardian_contact_id = c.id
    where c.org_id = new.org_id and c.party_id = new.id
  ) then
    raise exception 'party is linked as a legal guardian and must remain an adult';
  end if;
  return new;
end $$;
drop trigger if exists parties_preserve_guardian_adulthood on public.parties;
create trigger parties_preserve_guardian_adulthood before update of dob on public.parties
for each row execute function public.preserve_crm_guardian_adulthood();
