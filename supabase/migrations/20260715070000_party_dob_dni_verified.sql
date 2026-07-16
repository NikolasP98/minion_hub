-- Party identity: date of birth (age is now derived from this) + PERUDEVS DNI
-- verification flag (toggleable checkmark in the CRM customers table).
-- Validation details (status/checked_at/api) live in metadata.dni_validation.
alter table public.parties add column if not exists dob date;
alter table public.parties add column if not exists dni_verified boolean not null default false;
