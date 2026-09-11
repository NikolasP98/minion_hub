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

1. ~~**There is no enclosing transaction to run inside.**~~ **WITHDRAWN — this correction was
   wrong, and the code now implements the spec as written.** `updateSellable` did not _have_ an
   enclosing transaction, but it could open one: `withOrgCore` doesn't nest, which forbids calling
   a ctx-level service function from inside a transaction — it does not forbid the caller from
   opening the transaction itself and handing the handle down. Slice 1 therefore does exactly what
   the spec's "Do" says: `syncSellableItem` takes a `CoreTx` (its spec'd signature
   `syncSellableItem(tx, ctx, finProductId, desired)`), `createSellable` wraps its call in its own
   `withOrgCore`, and `updateSellable` runs the item insert and the `fin_products` update on ONE
   handle.

   The ordering-only version this bullet originally defended was not merely weaker, it was
   **wrong**: `PATCH {code: <a code another product holds>, trackStock: true}` committed the item
   insert and then failed the rename on `fin_products_org_code_uniq`. The caller got an error
   after a durable state change, and the residual could never self-heal — every retry re-hits the
   same code conflict, and `true→false` is refused. Found in review of this branch; fixed here.
   Regression: `pos.sellables.test.ts` → "a code collision on the SAME request reports code_taken
   and does not commit the stock link", plus the transaction-count assertion in "runs the item
   insert and the fin_products update in ONE transaction".

2. ~~**`getSellableRow()` carries neither `trackStock` nor `uom`.**~~ **WITHDRAWN — implemented
   instead.** The observation was true of `master`, but the conclusion (satisfy the DoD by proxy)
   was not the spec's: §8 step 2 reads the sellable back and asserts
   `.trackStock==true and .uom=="Unidad"` literally, so the projection has to carry them.
   `SellableRow` now exposes `trackStock` (derived, ≡ `itemId != null`) and `uom` (the linked
   item's, null when nothing is linked), both selected in the existing `SELLABLE_MERGE_SQL` merge
   — `i.uom`, functionally dependent on the already-present `group by i.id`, so no extra query and
   no DDL. `deriveSellableFacts` is now a straight narrowing of that row and its separate
   `select uom from stk_items` round trip is gone (one query saved on every guarded PATCH).
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

## 3. The operator path — deferred by the approved scope

Two review rounds recorded the same finding: the service-layer transition shipped, but
`SellableWizard.svelte` stripped `kind`/`trackStock`/`uom` from its edit-mode PATCH and rendered
`m.pos_catalog_kind_locked()` in place of the controls, so **no operator could reach it**. The
first round asked for either a re-approved spec or an in-repo `TODO(handoff)` plus a minion-meta
proposal; the second round rejected the local prose draft as a substitute for the ledger.

The approved spec contradicts itself:

- §5 "Files touched" and §7 "Out of scope" say no `.svelte` file is edited, and §8's ship gate
  mechanically enforces it (`git diff --quiet <base>...HEAD -- '*.svelte'`).
- §8 step 5 is an **operator probe**: tick the control, save, reload, read the value back. It
  cannot pass while the control does not exist.

This branch follows the mechanical approved gate: it contains no `.svelte` diff. Edit mode still
omits `kind`/`trackStock`/`uom` from PATCH and shows the locked caption, so the operator probe is
not represented as shipped here. The API/service transition and its response projection are the
implemented Slice-1 surface. The 2026-08-30 PR review records the deferred follow-up: reconcile
and re-approve the authoritative spec, then deliver the wizard controls, payload, i18n message,
and mounted component test under that approved scope.

## 4. Persistence, concurrency and rollback — proved against real PostgreSQL

The second review round was right that the branch's "no integration harness exists" claim was
false, and right that `hub-supabase-schema-not-reproducible` does not block a minimal fixture:
`.github/workflows/ci.yml` already provisions PostgreSQL, applies a CI-only schema fixture, and
asserts from a vitest JSON report that the suite did not skip
(`crm-funnel-concurrent-postgres` + `supabase/ci-fixtures/crm-funnel-concurrent.sql`).

This change adds the POS counterpart:

| Artifact                                                           | What it does                                                                                                                                              |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/ci-fixtures/pos-sellable-transition.sql`                 | The subset `updateSellable` touches, with per-table provenance (copied from a migration vs reconstructed from Drizzle) and executable catalog assertions. |
| `src/server/services/pos.sellables.concurrent.integration.test.ts` | Eight cases against a real server, through the shipped `createSellable`/`updateSellable` and the real `withOrgCore` (`app_ledger` + org GUC).             |
| `pos-sellable-transition-postgres` CI job                          | Applies the fixture, runs a cross-org RLS negative control, then gates on `8 passed / 0 pending` from the JSON report.                                    |

What the eight cases prove, none of which a mock can:

1. Two concurrent identical false→true updates serialize behind the product lock and return one
   linked `stk_items` row. The barrier is a pinned `fin_products` row plus polling
   `pg_stat_activity`, so the contended interleaving is reached deterministically.
2. A false→true transition and a concurrent product rename both survive serialization while only
   one linked item exists.
3. A same-request code collision → `code_taken`, **zero** `stk_items` rows, and the product's own
   `code`/`name` unchanged.
4. Create-tracked vs create-service-then-transition store the SAME item row (parity read back from
   the table, not from a mock's arguments).
5. A whitespace-only uom is stored as `'unit'`.
6. An invalid later consumption row rolls back the product, stock link, and prior recipe together.
7. Concurrent consumption replacements leave one complete submitted recipe, never their union.
8. Concurrent disjoint product-field PATCHes both survive after the row lock serializes their reads.

Mutation-checked, not assumed: splitting the item insert back into its own `withOrgCore` makes
cases 1–3 fail.

### What the real database caught immediately

`isUniqueViolation` in `pos.service.ts` read `e.code` directly. **drizzle wraps driver errors in
`DrizzleQueryError`, so the SQLSTATE sits on `e.cause`** — the check never matched a real server,
and `code_taken` / `item_taken` were dead in production while a raw 500 escaped instead. The unit
suite could not see it because it injected a flat `{code: '23505'}`, which is the only shape the
broken check matched.

Fixed by routing through the cause-chain walk that already existed (and was already live-verified
against the same class of bug) in `meta-sync-jobs.service.ts`, now extracted to
`src/server/db/pg-error.ts` so there is one copy. The unit tests for both `code_taken` and
`item_taken` now inject the WRAPPED shape, so the regression cannot come back.

**Adjacent, pre-existing, NOT touched by this change** (recorded as a fact of the audit, not as an
open end this branch created): `finance-statements.service.ts:175` and
`finance-sync-jobs.service.ts:65` still do the bare `e.code === '23505'` read and are presumably
subject to the same wrapping. They are outside this slice's surface and have their own suites.

## 5. Slice 2 remains open

`uom`-on-pristine is untouched. It still needs `itemHasHistory` over the complete predicate
(ledger/movement rows, non-zero bin quantity, billed-line reference) under the repository's
established lock, per the spec's Slice 2 — including its stop-condition that an incomplete
predicate is a re-spec, not a PR note. Its `TODO(handoff):` marker in `pos.service.ts` is its
ledger entry, and it is the one this branch deliberately leaves in place (Slice 1's own gate pins
the marker count in that file to baseline − 1).

## 6. Blank unit of measure

`z.string().min(1)` accepts `"   "`. Both sellable routes now use `z.string().trim().min(1)`, so
whitespace-only input is a 400 at the trust boundary, and `normalizeUom()` in `pos.service.ts`
trims-then-defaults where the value is actually written — the gateway POS tools call the service
directly and never pass a Zod schema. Covered by case 5 of the integration suite.
