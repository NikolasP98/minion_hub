# updateSellable Slice 1 — Slice-0 recon actuals, evidence, and open ends

Spec: minion-meta `specs/2026-08-20-handoff-minion-hub-902723699-spec.md`
(blob `db36b5007af060593bb267e32eed097da11cbb8a`, `status: implementing`, `verdict: approved`).
Ancestor: `2026-08-17-hub-updatesellable-silent-drop-spec` (S1 shipped as hub PR #120, `7fdc291`).

**This change ships Slice 1 only.** Slice 2 (`uom` on a pristine item) is untouched and its
`TODO(handoff):` marker is deliberately left in place.

---

## 1. Slice-0 recon actuals (§3 of the spec)

Run on base `master` @ `1b47e8c`.

| Recon item                                                    | Actual                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git log -- src/server/services/pos.service.ts`               | last spec-related commit is `7fdc291 factory: updateSellable S0+S1 (#120)`. **No S2 commit exists** — the two markers are live, not stale.                                                                                                                                                                                          |
| `HANDOFF_BASELINE` (`rg -c 'TODO\(handoff\)' pos.service.ts`) | **2**                                                                                                                                                                                                                                                                                                                               |
| Target marker 1 (was `:1393`, found at `:1406`)               | `TODO(handoff): apply the safe trackStock transitions (false→true: create the link; true→false on a pristine item: unlink) …` — **removed by this change**                                                                                                                                                                          |
| Target marker 2 (was `:1407`, found at `:1420`)               | `TODO(handoff): apply a uom change when the linked item is pristine (no ledger history) …` — **left in place (Slice 2)**; its pointer was re-aimed at this spec's S2.                                                                                                                                                               |
| S1 shape                                                      | Confirmed as described: `deriveSellableFacts` + typed `PosError` `kind_derived` / `stock_tracking_immutable` / `uom_immutable`, `normalizeUomForCompare` trim+case-fold, unchanged resubmit is a 200 no-op.                                                                                                                         |
| `createSellable` item-sync                                    | Confirmed. Two branches: `itemId` → `updateItem(…, {finProductId})` with 23505 → `item_taken`; else `kind==='product' && trackStock` → `createItem({code, name, uom: uom ?? 'unit', finProductId})`.                                                                                                                                |
| Linked-item uniqueness                                        | **Present.** `supabase/migrations/20260719230000_stk_items_fin_product_uniq.sql` creates the partial unique index `stk_items_org_fin_product_uniq on stk_items (org_id, fin_product_id) where fin_product_id is not null`. The spec's stop-condition ("if the guarantee is absent, stop and re-spec Slice 1") does **not** trigger. |
| PATCH envelope                                                | `PATCH /api/pos/sellables/:id` → `json({ ok: true, sellable })`; `PosError` → `{error, code}` at 400 via `handlePosError` (`not_found` → 404).                                                                                                                                                                                      |
| GET envelope                                                  | There is **no** `GET /api/pos/sellables/:id`. The single-sellable read is `getSellableRow()` internally; over HTTP the list is `GET /api/pos/sellables` → `{ sellables: [...] }`. The spec's §8 step-2 `curl … /sellables/$S                                                                                                        | jq '.kind…'`is not a real route — read the row back from the list, or from the PATCH response's`.sellable`. |

### §2 AS-IS corrections (recorded here rather than silently implemented against)

1. **There is no enclosing transaction to run inside.** Slice 1's "Do" says _"Run inside the
   existing transaction; a failed item insert rolls back the `fin_products` update."_
   `updateSellable` has no such transaction: like `createSellable`, it makes **sequential
   ctx-level `withOrgCore` calls**, and `withOrgCore` does not nest (documented on
   `createSellable`, same reason as the accrual hook in `stock-accruals.service.ts`).
   Implemented instead by **ordering**: the item write happens _before_ the `fin_products`
   update, so a failed item insert leaves the product row untouched — which is the observable
   property the DoD actually asserts. The residual (item committed, product update fails)
   self-heals on retry: the retry derives `trackStock: true`, takes no transition, and applies
   the field edits.
2. **`getSellableRow()` carries neither `trackStock` nor `uom`.** `SellableRow` exposes
   `kind` and `itemId` (trackStock ≡ `itemId != null`); `uom` is only reachable through
   `deriveSellableFacts`. The DoD line "getSellableRow() reports kind 'product', trackStock true,
   uom 'Unidad'" is satisfied as: `kind === 'product'`, `itemId != null`, and the `createItem`
   payload carrying `uom: 'Unidad'`.
3. **Bundles are excluded from the transition.** `mapSellableRow` derives `'bundle'` _ahead of_
   the item link, so linking an item to a bundle would set `trackStock` true while `kind` stayed
   `'bundle'` — a state no slice specifies. Bundles keep S1's `stock_tracking_immutable` refusal
   (fail-closed). The spec says "on a service sellable" throughout; this makes that literal.

## 2. A1 — consumer inventory (§6)

Searched for `sellable` / `/api/pos/sellables` across every checkout available to this run.

| Checkout                                         | Result                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `minion_hub` (this repo)                         | 3 callers: `src/lib/components/pos/SellableWizard.svelte:250` (POST + PATCH), `src/routes/(app)/pos/catalog/+page.svelte` (GET/list), `src/lib/modules/route-guard.test.ts` (path assertion only). Service-level callers are only the two route files. **None depends on the refusal** — see §3 for the wizard. |
| `minion/`, `paperclip-minion/`, root `packages/` | **Unavailable** — not checked out in this environment. Recorded as unavailable, **not** as zero hits, per §6's instruction. Any gateway POS/catalog tool that PATCHes a whole sellable object still needs its own verification before this reaches those callers.                                               |

## 3. Open end — the transition is unreachable from the wizard

`SellableWizard.svelte` **strips `kind`/`trackStock`/`uom` from the PATCH body** (line ~220:
_"kind/trackStock/uom/itemId are creation-only — updateSellable ignores them on PATCH"_) and
renders `m.pos_catalog_kind_locked()` instead of the controls when `editing` (line ~332). So the
service-layer transition shipped here is live over the API but **an operator cannot reach it from
the UI**, and those two wizard comments are now stale (post-S1 the API refused; post-Slice-1 it
applies).

This is a contradiction inside the approved spec, not a shortcut taken here:

- §5 Files touched and §7 Out of scope both say **no `.svelte` file is edited**, and §8's ship
  gate mechanically enforces it (`git diff --quiet <base>...HEAD -- '*.svelte'`).
- §8 step 5's operator probe nevertheless expects the wizard to persist the value.

Slice 1 honours §5/§7/§8's mechanical gate — **no `.svelte` file is touched**, which is also why
the ledger's usual in-code `TODO(handoff):` marker is recorded here instead of inside
`SellableWizard.svelte`: placing it there would break the spec's own ship gate.

**Follow-up needed (own proposal, hub):** send `trackStock`/`uom` on PATCH and unlock the
edit-mode controls for the service→tracked case only, refreshing the two stale comments. Until
that ships, the operator-facing half of the proposal's DoD is unmet even though the API half is
met.

## 4. Slice 2 remains open

`uom`-on-pristine is untouched. It still needs `itemHasHistory` over the complete predicate
(ledger/movement rows, non-zero bin quantity, billed-line reference) under the repository's
established lock, per the spec's Slice 2 — including its stop-condition that an incomplete
predicate is a re-spec, not a PR note. The marker at `pos.service.ts:1480` is its ledger entry.
