# Cross-module data lifecycles — stress scenarios (local QA stack)

Target: `http://127.0.0.1:5199` only. Personas: `.env.qa.local`. Fixtures: `scripts/qa/seed/matrix.ts`. These stories follow one business object through several modules and verify, after **every** step, that each module's view of the data agrees. "Verify" means: read the value in the UI **and** through the module's API (`/api/pos/*`, `/api/scheduling/*`, `/api/stock/*`, `/api/crm/*`, `/api/finances/*`, `/api/pos/accounts`) and write both numbers in the report. A mismatch between two modules is a defect even when each module is self-consistent. Screenshot every step. Prefix everything you create with the story id (`L1-`, `L2-`, …). Context for judgement: POS is the front desk of an SMB clinic/salon — the place where a sale, a booking and a payment are registered in one flow with the least clicks; Stock is what the back office checks weekly; management wants totals that reconcile.

## L1 — Walk-in client, first visit to loyal (owner)
1. CRM: create `L1-Client` via `/pos/sell` quick-add with a new DNI → `/crm/customers` shows exactly one contact and `/pos/accounts` exactly one row (party and contact ids both present in `/api/pos/accounts`).
2. Sell: plain service + tracked product + the package-with-validity to L1-Client, cash. Verify: ticket total = Σ lines; stock of the tracked product −1 and of both consumption items per `qty_per_unit` (read `/api/stock/items`); one grant N/N on `/pos/accounts`; the CRM contact's journey/funnel moved off `lead` (or record that it didn't); the contact detail shows the ticket/booking cards.
3. Schedule step: book the service for tomorrow on Lima staff → `/scheduling/calendar` shows it with the client's name; the booking's detail shows the ticket link; `/pos/accounts` has no pending-scheduling entry for L1.
4. Draw 1 package session from the accounts drawer for next week → grant N−1/N; calendar shows the second booking; `/api/scheduling/bookings/<id>` carries `package_grant_id`.
5. Cancel the drawn session with scope "this only" → grant back to N/N, a reversed redemption listed, the booking `cancelled`; the first booking untouched.
6. Complete the first booking (mark completed) → any stock accrual for the service is `realized` (`/api/stock/accruals` or the item's history); the CRM contact's "last visit"/activity updated; the funnel stage advanced if the rules say so — record.
7. Void the ticket → stock restored for product and consumption items (exact quantities), grant cancelled or removed (record which), the completed booking left in place with a warning or cancelled (record), the account balance unchanged (cash sale), the CRM cards reflect the void. Every module must agree on "this sale no longer exists".

## L2 — Package lifecycle across weeks (owner)
1. Sell the no-validity package (N sessions) to `crm.contact.dni-verified`; draw sessions on N different days across 3 weeks via `/pos/appointments/new` (grant-draw control if present, else the accounts drawer). After each draw: grant count, calendar, and `/api/pos/accounts` agree.
2. Reschedule the third session to another day → still counted once; drag it onto an occupied slot → refused, count unchanged.
3. Draw the last session → grant exhausted; try one more → refused with a readable reason; the client's drawer shows "exhausted", not "0 left" with an enabled button.
4. Sell the same package again → a second, separate active grant; draws come from the new grant only; the old one stays exhausted in history.
5. Management: `/pos/accounts` totals and any package/liability metric on `/overview` or `/finances` reconcile with Σ unused sessions × unit value across grants (write the sum).

## L3 — Instalment plan to settlement to invoice (owner)
1. Open a 3-instalment plan for a 450.00 treatment from the accounts drawer; pay instalment 1 (card), 2 (cash + credit from a topped-up balance), 3 (cash). After each: plan status, paid/remaining, ledger rows, three tickets each `sum(payments)==total`, shift totals including the surcharge if card carries one.
2. Void instalment 2's ticket → plan back to 1/3 or flagged — record; credit restored to the ledger; the shift totals drop by that ticket.
3. Re-pay instalment 2, then 3 → settled; "Pay instalment" disappears; `/finances/invoices` (or the ticket list) shows three documents with consecutive correlativos and the shadow emission rows if emission is on.
4. Close the shift → the close summary's tender totals equal Σ payments of non-void tickets in that shift (write the arithmetic); reopen a shift the next "day" and confirm yesterday's tickets do not leak into it.

## L4 — Stock replenishment to sale to count (owner + staff)
1. Owner: receipt 24 units of `stock.item.uom-conversion` at 3.50 into default; staff: sell 5 of the product mapped to it via `/pos/sell`; owner: transfer 10 to child; staff: sell 3 more (from which warehouse does the sale draw? record); owner: adjustment −1 (breakage) with a note. After each step, on-hand per warehouse, total, and moving-average rate from `/stock`, from `/api/stock/bins` and from the ledger agree; write the running table.
2. Reorder: set reorder level above on-hand → flag appears on `/stock`; receive → clears.
3. Attempt to sell 100 of the product → refused by stock with a readable message naming the available quantity (or allowed with a negative-stock warning — record, and check whether the ledger then goes negative).
4. Management: total inventory valuation shown anywhere (`/stock` header, `/overview`, `/finances`) equals Σ(on-hand × valuation rate) across items (write the sum).

## L5 — Booking-first flow: public link to paid visit (anonymous + owner)
1. Anonymous: book via the seeded public link as a new person with phone + email (if creation is blocked by the known `requireAdmin` bug, use an existing link; record). Owner: the booking is `pending` or `accepted` per the event type; a party/contact exists once; `/pos/accounts` lists it with nothing pending.
2. Owner: from the booking's drawer or from `/pos/sell` select that client and sell the linked service → the ticket line is linked to the existing booking (no second booking created, no pending-scheduling flag).
3. Mark no-show → the ticket remains paid; any accrual released; the CRM activity shows the no-show.

## L6 — Identity-required org (owner of `org.business.identity-required`, via `tenancy.user.two-orgs` if a member, else record blocked)
1. Sell to a client without a document → refused; add a DNI → allowed; quick-add a RUC → company; sell a `01` document → factura series used.
2. The same client must not exist twice after the flow (`/crm/customers` and `/pos/accounts`).

## L7 — Concurrency across modules (two contexts)
1. Owner sells the last unit of a product while staff issues it from `/stock` → exactly one succeeds; ledger never negative; the loser's message names the cause.
2. Owner draws the last package session from the accounts drawer while staff books it from the appointment page → one succeeds; grant count correct; no orphan booking.
3. Owner voids a ticket while staff schedules its pending service → consistent end state (record which wins and whether the other is refused).

## L8 — Management view (owner, then manager)
1. Record every number visible on `/overview`, `/finances` (revenue today/week), `/pos` shift summary, `/stock` valuation, `/scheduling` counts, and compare each to a sum you compute from the module lists/APIs for the same period. List every metric that does not reconcile, is missing for an SMB (e.g. sales by method, by staff, no-show rate, low-stock count, package liability, pending instalments), or is labelled unclearly.
2. Manager sees the same metrics; staff sees only their own; viewer sees read-only.
