-- attachment_links: polymorphic "document ↔ object" primitive (spec
-- 2026-09-12-erp-core-modules-attachments-spec, slice S1+S2). One `files` row
-- (public.files, owned by @minion-stack/db/pg — id text, tenant_id uuid) can
-- attach to one or many ERP objects at once (a CRM contact, a booking, an
-- event type/service, a stock item, an invoice, a stock entry, a POS ticket)
-- by inserting one row per link. `file_id` is a soft ref (no FK — files lives
-- in the meta package, precedent: meta_post_media.file_id,
-- 20260705120000_meta_post_media.sql). `org_id text` matches the ERP tables
-- (not files.tenant_id, which is uuid). Tenancy: app_ledger role +
-- app.current_org_id GUC, same shape as 20260908000000_event_kinds_and_tag_links.sql.
-- Idempotent.

create table if not exists public.attachment_links (
  org_id     text not null,
  file_id    text not null,
  object_type text not null check (object_type in (
    'crm_contact', 'booking', 'event_type', 'product',
    'stk_item', 'fin_invoice', 'stk_entry', 'pos_ticket'
  )),
  object_id  uuid not null,
  linked_by  uuid,
  linked_at  timestamptz not null default now(),
  primary key (object_type, object_id, file_id)
);
create index if not exists attachment_links_org_file_idx
  on public.attachment_links (org_id, file_id);
create index if not exists attachment_links_org_object_idx
  on public.attachment_links (org_id, object_type, object_id);

-- RLS: org isolation via app_ledger + GUC (same shape as 20260903000000_hr_module.sql).
grant select, insert, update, delete on public.attachment_links to app_ledger;

alter table public.attachment_links enable row level security;
alter table public.attachment_links force  row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'attachment_links_org_guc') then
    create policy attachment_links_org_guc on public.attachment_links
      for all using (org_id = current_setting('app.current_org_id', true))
              with check (org_id = current_setting('app.current_org_id', true));
  end if;
end $$;
