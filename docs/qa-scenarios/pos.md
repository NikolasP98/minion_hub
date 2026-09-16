# POS — stress-test scenarios (local QA stack)

Target: `http://127.0.0.1:5199` only. Personas: `.env.qa.local`. Fixtures: `scripts/qa/seed/matrix.ts` (`pos.*`, `catalog.*`, `crm.*`). POS moves money: after every sale, read the ticket total, the payments, the ledger and the account balances from the UI and check the arithmetic by hand in the report. Screenshot every step; record every failing request with its URL and response, every 500, every console error. Known defects from the first pass (do not re-file, but confirm or update): viewer can open `/pos/sell` (D1); `PUT /api/pos/settings` 500 (D2); DNI quick-add creates party-only (D3) and splits accounts (D4); no grant-draw on the new-appointment page (D5); no instalment option at the pay step (D7); "Pay instalment" prefills the full balance (D8).

Seeded facts: `org.business` settings — methods cash/card/yape/plin/transfer + `credit` (no tendered), card surcharge, `emission.mode = shadow` with beta series 03 and 01; `pos.shift.open`; tickets `split-tender-with-change`, `credit-tender`, `voided`, `service-pending-scheduling`, `bundle-two-grants`; grants `half-used`, `exhausted`, `expired`, `cancelled`; `pos.redemption.reversed`; plans `open-2-of-3-paid`, `settled`, `cancelled`; ledger topup/deposit/redemption/refund/adjustment across three parties (positive, zero, negative balances); catalog: plain service, tracked product, bundle of two services, package with validity, package without validity, inactive sellable, product consuming two items. Second business org `org.business.identity-required` has `requirements.identityDocument = required`.

## P1 — Shift lifecycle (owner, then staff)
1. `/pos` with the seeded open shift: banner shows opening float; close it with a counted amount ≠ expected → variance shown, shift `closed`; the closed-shift summary lists tickets and tenders by method.
2. Sell with no open shift → the sell page prompts to open one (or blocks); open a shift with float 100.00; try to open a second shift → refused (one open per org).
3. Staff in module mode: the shift banner and open/close controls are present (regression of the earlier missing-button fix).

## P2 — Cart arithmetic and modifiers
1. Add the plain service ×2, the tracked product ×3, change a line qty to 0 → line removed or refused; qty 0.5 on a unit product → refused or rounded; qty 1000 → allowed, total correct.
2. Line discount 10 % on one line, then order-level discount 5.00 → subtotal, discount and total recompute; discount greater than the line → refused or clamped, never negative.
3. Price override on a line (allowed for owner if `allow_price_override`) to 0.01 and to 0 → record behaviour; as staff → override control absent or refused.
4. Add the bundle: lines expand or a single bundle line with components shown; component modifiers (exclude one, add one) change nothing on the price unless configured; record.
5. Add the inactive sellable via search → not offered; via URL/param if possible → refused.

## P3 — Tenders
1. Total 120.00: cash tendered 200.00 → change 80.00; submit; the receipt shows tendered and change.
2. Split: card 50.00 (+ surcharge shown separately and added to the total), yape 30.00, cash for the rest with tendered rounding; the payments sum equals the total including surcharge — write the numbers.
3. Overpay with card (card 200 on a 120 total) → refused (card has no tendered/change); underpay and submit → refused with the remaining amount named.
4. Credit tender on the positive-balance party for exactly the balance → balance 0.00; another credit sale of 0.01 → refused ("Not enough credit"); credit tender on the negative-balance party → refused.
5. Mixed: credit 30.00 + cash 90.00 on a 120.00 total → ledger row −30.00 of kind `redemption`, payments sum 120.00.
6. Top up a party's account by 50.00 from `/pos/accounts` (if the UI allows) → ledger `topup` +50.00; refund 20.00 → `refund` −20.00; the balance reads 30.00.

## P4 — Void and reversal
1. Void the cash+card split ticket → stock restored for the tracked product, the credit ledger unchanged (no credit used), the ticket status `voided` with who/when; the closed-shift totals exclude it.
2. Void the credit-tender ticket → a reversing ledger row (+amount) appears; balance restored; void it again → refused.
3. Void a ticket from a closed shift → refused or allowed with reason — record.

## P5 — Packages (grants)
1. Sell `catalog.package.with-validity` to the DNI-verified contact → a grant with N sessions and an expiry date N days out; `/pos/accounts` shows it once (not twice — D4 check).
2. Draw sessions: from the accounts drawer, book 1 session → used 1/N; book another via `/pos/appointments/new` choosing "draw from package" if it exists (D5) → used 2/N; cancel the second booking → used 1/N and a reversed redemption listed.
3. Exhaust the grant: draw until N/N → status shows exhausted; drawing again → refused; the seeded `expired` grant → cannot draw, shows expired; `cancelled` → hidden or greyed.
4. Sell `catalog.package.no-validity` → no expiry shown; sell the bundle of two services → two grants (one per component); record the per-session unit values (line total / (qty × Σ component qty)).
5. Sell the same package with qty 2 → grants double the sessions or two grants; unit value correct.

## P6 — Payment plans (instalments)
1. Open a plan for a 300.00 service in 3 instalments from wherever the UI allows (accounts drawer "Open plan"; note if the pay step offers it — D7): three due entries; pay the first → 1/3; the `Pay instalment` prefill equals the next instalment (100.00), not the balance (D8 check).
2. Pay the second with a split tender (cash 60 + card 40) → 2/3; pay the third → plan `settled`, no further "Pay instalment" action offered.
3. Uneven split 100.00 / 3 → 33.34 + 33.33 + 33.33; pay all three → settled at exactly 100.00.
4. Cancel a plan after one payment → status `cancelled`; the paid ticket stays; no refund is implied (record what the UI says).
5. Open a plan for the seeded `open-2-of-3-paid` contact while it already has an open plan → allowed (multiple plans) or refused; record.

## P7 — Identity requirement and quick-add
1. In `org.business.identity-required` (switch org as `tenancy.user.two-orgs` if it is a member there; else set the requirement via settings — expect D2's 500 and record it): sell to a walk-in with no customer → refused with `identity document required`; sell to `crm.contact.dni-missing` → refused; add a DNI in quick-add → allowed.
2. Quick-add with an invalid DNI (7 digits, letters) → validation error; with a DNI already on file → the existing client is selected, not duplicated; with a new 8-digit DNI → lookup (or manual name fallback) → client created; then `/crm/customers` shows it (D3 check) and `/pos/accounts` shows one row for it (D4 check).
3. RUC (11 digits) quick-add → company party; the ticket document default flips to `01` (factura) if configured.

## P8 — Service sale → scheduling step
1. Sell the plain service → after payment the scheduling step appears; schedule it → booking created, linked to the ticket line, no pending flag; sell another and skip → `/pos/accounts` lists it as pending; schedule from there → flag clears.
2. Sell a service with qty 3 → the scheduling step offers three bookings or one; record; pending count reflects unscheduled lines.
3. Void a ticket that has a scheduled booking → booking cancelled or left with a warning; record.

## P9 — Emission (shadow)
1. Submit a `03` sale → an emission row `pending` → `accepted`/`rejected`/`error` appears in the ticket detail (beta, no real SUNAT); the serie/correlativo increments; two sales in a row have consecutive correlativos; a voided ticket does not reuse its number.
2. Switch `emission.mode` to `off` in settings (if D2 allows) → new sales create no emission rows.

## P10 — Accounts page
1. `/pos/accounts` shows every seeded party once with balance, grants, plans, pending-scheduling; sort/filter by balance sign; open the drawer for the negative-balance party → ledger rows in order with running balance; export (if present) matches.
2. At 390 px the drawer becomes a sheet; all actions reachable.

## P11 — Permissions
1. Viewer: `/pos/sell` (D1 — record current behaviour), `/pos/accounts` read-only, `/pos/settings` denied.
2. Staff: can sell, cannot open `/pos/settings`, cannot void (or can — record), cannot override prices.
3. Manager: can void and close shifts.

## P12 — Concurrency and volume
1. Two contexts (owner + staff) sell the last 1 unit of the tracked product within 1 s → one succeeds, the other gets a stock error, no negative stock.
2. Two contexts draw the last session of a grant simultaneously → one succeeds.
3. Submit 20 small cash sales as fast as possible → all 20 tickets exist with sequential human ids and correct shift totals; record the slowest submit time.
