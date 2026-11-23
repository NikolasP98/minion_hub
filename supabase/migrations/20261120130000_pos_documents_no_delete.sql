-- Spec 138 H3. Sales documents are never deleted and stock ledger rows are final.
--
-- WHAT: no application or API role can DELETE (or TRUNCATE) pos_tickets, pos_ticket_lines or
-- pos_payments, and no API role can UPDATE, DELETE or TRUNCATE stk_ledger.
-- A mistaken document is voided/cancelled; a stock mistake is a compensating ledger row.
--
-- UPDATE stays on the three document tables for app_ledger: void and in-place payment
-- correction need it. app_ledger keeps SELECT+INSERT on stk_ledger (it never had more).
-- TRUNCATE was granted to anon/authenticated/service_role by GRANT ALL; it is revoked too,
-- since a role that cannot delete must not be able to empty the table.
--
-- Not affected: foreign-key ON DELETE CASCADE actions run as the referencing table's owner.
--
-- NAMED EXCEPTION: an owner-requested sweep of test data runs as the table owner role, after a
-- snapshot, in one transaction, with stock balances rebuilt. This revoke does not block it.
--
-- Role names all exist in the QA baseline and production (granted in supabase/qa/baseline/schema.sql),
-- so no pg_roles guard is used, matching 20261003130000_pos_wallet_currency.sql.

REVOKE DELETE, TRUNCATE ON TABLE public.pos_tickets, public.pos_ticket_lines, public.pos_payments
  FROM PUBLIC, anon, authenticated, service_role, app_ledger;

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.stk_ledger
  FROM PUBLIC, anon, authenticated, service_role;
