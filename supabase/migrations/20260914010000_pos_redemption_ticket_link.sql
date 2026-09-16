-- One ticket line per redeemed package session.
-- Spec: specs/2026-09-13-pos-scheduling-packages-payment-plans-spec.md §3.2
-- (slice S5); proposals/2026-09-13-pos-packages-plans-s1-followups.md §11, §20.
--
-- `submitTicket` now stamps pos_package_redemptions.ticket_id / ticket_line_id
-- inside the money transaction with `where ticket_id is null`, so a drawn
-- session can only ever be claimed by ONE live ticket line; `voidTicket` clears
-- the stamp again so a corrected ticket can re-bill it. This index is the
-- database-side backstop for that claim.
--
-- Deliberately on the REDEMPTION side, not `pos_ticket_lines (org_id,
-- redemption_id)` as proposals §11 sketched: a voided ticket's lines keep their
-- redemption_id as history, so a unique index there would permanently block the
-- re-ring that clearing the stamp exists to allow. The stamp is the live link;
-- the line column is the audit trail.
--
-- Idempotent. Additive only — no data is rewritten.
create unique index if not exists pos_package_redemptions_ticket_line_uniq
  on public.pos_package_redemptions (org_id, ticket_line_id)
  where ticket_line_id is not null;
