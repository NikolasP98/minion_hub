# Stock — stress-test scenarios (local QA stack)

Target: `http://127.0.0.1:5199` only. Personas: `.env.qa.local`. Fixtures: `scripts/qa/seed/matrix.ts` (`stock.*`, `catalog.*`, `pos.*`). Screenshot every step; record every request that fails, every 500, every console error, every number that does not add up. Stock is money: after every mutation, read the item's on-hand quantity and valuation from the UI and check them against what you expect by hand; write the arithmetic in the report.

Seeded facts: warehouses default, child, `stock.warehouse.archived`; items `stock.item.uom-conversion` (box → units, `units_per_stock_uom`), `stock.item.recipe-with-optional-child` (recipe with a choice group), a low-stock item under its reorder level; entries chain receipt → issue (with `metadata.invoiceId`) → transfer → adjustment → cancelled; bins at zero; accruals `open|realized|released`; consumption mappings from catalog products to items (one product consumes two items).

## K1 — Lists, filters, empty states (owner)
1. `/stock` shows items with on-hand, uom, reorder flag; the low-stock item is flagged; the archived warehouse is not offered in filters but still appears in history.
2. Filter by the child warehouse → only its bins; by the archived warehouse (if allowed) → read-only history.
3. `/stock` at 390 px: table scrolls inside its container; the page body has no horizontal scroll.

## K2 — Receipts with valuation (moving average)
1. Receipt 10 units of `stock.item.uom-conversion` at rate 5.00 into default → on-hand +10 (in stock uom), valuation 5.00.
2. Receipt 10 more at 7.00 → on-hand 20, moving average 6.00; the ledger shows two rows with `qty_after` 10 then 20 and `valuation_rate` 5.00 then 6.00.
3. Receipt with rate 0 → refused or warned (rate is required on receipts); with negative qty → refused; with 0.001 qty on a unit-uom item → refused or rounded — record.
4. Receipt in box uom (conversion factor) → on-hand increases by boxes × units; the ledger stores the stock uom.

## K3 — Issues, consumption and the invoice identity
1. Issue 5 units from default with `metadata.invoiceId = QA-INV-777` → on-hand 15; bin updated.
2. Second issue with `invoiceId = " qa-inv-777 "` (case/space variant) → refused by the normalizing unique index; the UI shows a readable error, not a 500.
3. Cancel the first issue → on-hand back to 20; the ledger has a reversing row; now the variant issue is accepted.
4. Issue more than on-hand (30 of 20) → refused with the available quantity named; issue exactly 20 → bin at zero; issue 1 more → refused.
5. Sell the product that consumes two items on `/pos/sell` (owner, open shift): both items decrease by their `qty_per_unit`; the ticket shows the stock entry link; the stock entry's `invoiceId` is the ticket's document; void the ticket → both items restored.

## K4 — Transfers
1. Transfer 8 units default → child → default 12, child 8; the ledger has an out row and an in row with the same valuation rate.
2. Transfer to the archived warehouse → refused; transfer from a warehouse with insufficient stock → refused; transfer to the same warehouse → refused.
3. Transfer in draft, then submit; then try to edit the submitted transfer → refused (submitted entries are immutable) or allowed with a new revision — record.

## K5 — Adjustments
1. Positive adjustment +3 at rate 6.50 → on-hand 15 in default; moving average recomputed; negative adjustment −4 → 11; adjustment below zero → refused.
2. Adjustment with no rate on a positive qty → refused (rate required for positive adjustments).

## K6 — Recipes and components
1. Open `stock.item.recipe-with-optional-child`; the optional child in its choice group is toggleable; issue the recipe with the optional child excluded → only the mandatory components decrease; include it → all decrease.
2. Make the child item's stock zero, then issue the recipe → refused, naming the missing component.

## K7 — Accruals from bookings
1. Book a service linked to a consuming product (`catalog.product.consumption-2-items` if linked, else link one in the catalog) → an `open` accrual appears for the items; complete the booking → accrual `realized` and stock decreases; cancel another such booking → accrual `released`, no stock change.
2. Reschedule a booking with an open accrual → the accrual follows (still one open accrual, same items).

## K8 — Reorder and low stock
1. Take the low-stock item above its reorder level with a receipt → flag clears; issue below → flag returns; set `reorder_qty` and check the suggested order quantity if shown.

## K9 — Ledger integrity under rapid actions
1. In two contexts (owner + staff) submit an issue of 6 and an issue of 6 on an item with 10 on hand, clicking within 1 s → exactly one succeeds; on-hand is 4, not −2.
2. Perform 15 mixed entries quickly (receipt, issue, transfer, adjust) on one item; then export or read the ledger: `qty_after` is monotonic and consistent step by step; the final on-hand equals the sum of movements; bins equal the last `qty_after` per warehouse.

## K10 — Permissions
1. Staff: can create receipts/issues? can cancel? can adjust? Record each. Viewer: `/stock` read-only, direct `POST /api/stock/entries` → 403.

## K11 — Personal org
1. As `tenancy.user.two-orgs` in the personal org: `/stock` → 404/redirect and no nav item.
