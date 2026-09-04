-- HR module follow-up (owner direction 2026-09-04):
--   • holidays carry a source (manual | country import) and an enabled flag —
--     editors toggle imported holidays instead of typing them;
--   • weekly off becomes ONE recurring rule in hr_settings (computed at read
--     time) instead of 52 materialised hr_holidays rows per year.

alter table public.hr_holidays add column if not exists source text not null default 'manual';
alter table public.hr_holidays add column if not exists source_key text;
alter table public.hr_holidays add column if not exists enabled boolean not null default true;
create unique index if not exists hr_holidays_org_source_key_uniq
  on public.hr_holidays (org_id, source_key) where source_key is not null;

create table if not exists public.hr_settings (
  org_id text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.hr_settings to app_ledger;
alter table public.hr_settings enable row level security;
alter table public.hr_settings force  row level security;
do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'hr_settings_org_guc') then
    create policy hr_settings_org_guc on public.hr_settings
      for all using (org_id = current_setting('app.current_org_id', true))
              with check (org_id = current_setting('app.current_org_id', true));
  end if;
end $$;

-- Backfill the recurring rule from the weekdays that were materialised, then
-- drop the derived rows (the rule now covers every year).
insert into public.hr_settings (org_id, value)
select h.org_id,
       jsonb_build_object('weeklyOff', (
         select jsonb_agg(distinct extract(dow from h2.date)::int)
         from public.hr_holidays h2
         where h2.org_id = h.org_id and h2.weekly_off
       ))
from public.hr_holidays h
where h.weekly_off
group by h.org_id
on conflict (org_id) do update set value = public.hr_settings.value || excluded.value, updated_at = now();

delete from public.hr_holidays where weekly_off;

-- hrms Employee: department + employment_type (Full-time / Part-time / Contract / Intern).
alter table public.hr_employees add column if not exists department text;
alter table public.hr_employees add column if not exists employment_type text;
