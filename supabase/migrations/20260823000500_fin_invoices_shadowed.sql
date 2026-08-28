-- Cross-provider dedup for the SUNAT cutover (owner decision 2026-08-22):
-- historical SUSII rows stay the canonical, item-level record; a SUNAT/SIRE
-- row for the SAME comprobante (org_id, document_id) is "shadowed" and
-- excluded from doc-level reads (lists, aggregates, CRM finance bridges) so
-- the full-history SIRE sweep never double-counts revenue. Maintained by
-- upsertInvoicesBatch on every sync batch. Applied to prod manually
-- 2026-08-22 (column + backfill); IF NOT EXISTS/idempotent for replays.
alter table public.fin_invoices
  add column if not exists shadowed boolean not null default false;

update public.fin_invoices f
   set shadowed = true
 where f.provider = 'sunat-sire'
   and not f.shadowed
   and exists (
     select 1 from public.fin_invoices s
      where s.org_id = f.org_id
        and s.document_id = f.document_id
        and s.provider = 'susii'
        and s.document_id is not null
   );
