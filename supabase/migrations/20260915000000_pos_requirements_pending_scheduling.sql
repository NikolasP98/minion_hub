-- Per-org POS requirements + the index behind "pending scheduling".
-- Spec: specs/2026-09-13-pos-scheduling-packages-payment-plans-spec.md §3
-- (follow-up slice); proposals/2026-09-13-pos-packages-plans-s1-followups.md.
--
-- 1) pos_settings.requirements — what an org demands of a ticket before it can
--    be submitted. An OPEN jsonb map, not a boolean column, because the list
--    grows per org (FACES needs an identity document per invoice; other orgs
--    need none, and later ones will need an address, a consent form, …):
--
--      { "identityDocument": "required" | "optional" | "off" }
--
--    Default '{}' = every requirement OFF, so no existing org changes behaviour
--    on deploy. Enforced in pos.service `submitTicket`
--    (PosError code `identity_document_required`).
--
-- 2) pos_ticket_lines partial index — /pos/accounts derives "pending
--    scheduling" as `service line with booking_id is null on a non-void
--    ticket`. Deliberately DERIVED, no status column: a booking attached later
--    (or a voided ticket) must never leave a stale flag behind. The partial
--    index keeps that derivation off a full table scan as ticket volume grows.
--
-- Idempotent. Additive only — no data is rewritten.
alter table public.pos_settings
  add column if not exists requirements jsonb not null default '{}'::jsonb;
--> statement-breakpoint
create index if not exists pos_ticket_lines_org_pending_scheduling_idx
  on public.pos_ticket_lines (org_id, ticket_id)
  where booking_id is null and kind = 'service';
