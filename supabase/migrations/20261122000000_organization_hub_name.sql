-- Optional owner-selected prefix; NULL follows the organization name. No backfill.
alter table public.organizations add column hub_name text default null;
alter table public.organizations add constraint organizations_hub_name_envelope
  check (hub_name is null or (
    octet_length(hub_name) between 1 and 256
    and hub_name = btrim(hub_name)
    and hub_name !~ '^[[:space:]]*$'
  ));
-- Existing member-select/admin-write RLS remains authoritative. Owners write
-- through the Hub's fresh, locked organization-administration transaction.
