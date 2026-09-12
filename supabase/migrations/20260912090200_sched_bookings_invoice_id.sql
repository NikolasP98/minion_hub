-- Booking ↔ invoice link (spec 2026-09-12-erp-core-modules-attachments, S6).
-- Soft ref only — no FK: invoices are provider-synced and may be re-imported
-- (upsertInvoicesBatch), so a booking must never block on an invoice row
-- disappearing/changing id underneath it. Nullable, additive, never mandatory
-- per the owner brief.
alter table public.sched_bookings add column if not exists invoice_id uuid;

create index if not exists sched_bookings_org_invoice_idx
  on public.sched_bookings (org_id, invoice_id)
  where invoice_id is not null;
