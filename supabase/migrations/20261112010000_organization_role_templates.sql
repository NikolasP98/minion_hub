-- Existing organizations retain their exact legacy role model. Only the
-- qualified, flag-gated bootstrap explicitly creates organization-model rows.
alter table public.organizations
  add column if not exists role_model text not null default 'legacy',
  add column if not exists default_role_key text;
alter table public.organizations
  add constraint organizations_role_model_check check (role_model in ('legacy','organization')),
  add constraint organizations_local_default_check check
    (role_model <> 'organization' or nullif(default_role_key,'') is not null);
---> statement-breakpoint
alter table public.org_roles
  add column if not exists template_id text,
  add column if not exists template_version integer;
alter table public.org_roles add constraint org_roles_template_provenance_check check
  ((template_id is null and template_version is null) or
   (template_id is not null and template_version is not null and template_id in ('admin','manager','staff','viewer') and template_version > 0));
---> statement-breakpoint
alter table public.join_link
  add column if not exists role_revision text,
  add column if not exists grantor_profile_id uuid;
comment on column public.organizations.role_model is
  'legacy preserves global system roles; organization requires explicit org-local assignments. Missing roles never imply admin.';
comment on column public.organizations.default_role_key is
  'Org-local role resolved at invite mint or request approval. Does not change existing assignments or outstanding invites.';

-- Account deletion spans a PostgreSQL transaction and the GoTrue API. A durable
-- admission fence prevents a concurrent invitation from reinstalling the final
-- local administrator between those two boundaries.
alter table public.profiles add column if not exists deletion_pending boolean not null default false;
