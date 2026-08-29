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

Slice 1 honours §5/§7/§8's mechanical gate — **no `.svelte` file is touched**.

**Ledger placement.** CLAUDE.md requires an in-code `TODO(handoff):` at the exact site. The two
sites the spec puts out of reach are `SellableWizard.svelte` (a `.svelte` diff fails §8's gate)
and `pos.service.ts` (a third marker there fails Slice 1's own
`rg -c 'TODO(handoff)' … -eq $((HANDOFF_BASELINE - 1))` count gate). The marker therefore sits at
the nearest reachable exact site — the PATCH request boundary,
`src/routes/api/pos/sellables/[id]/+server.ts` — and names both blocked sites and the reason. It
is a marker in code, not prose in a plan file.

**Follow-up needed (proposal P1, §5):** send `trackStock`/`uom` on PATCH and unlock the edit-mode
controls for the service→tracked case only, refreshing the two stale wizard comments. Until that
ships, the operator-facing half of the proposal's DoD is unmet even though the API half is met —
the API half is now met _literally_, since the PATCH response's `.sellable` carries `trackStock`
and `uom` (see §2 correction 2).

## 4. Slice 2 remains open

`uom`-on-pristine is untouched. It still needs `itemHasHistory` over the complete predicate
(ledger/movement rows, non-zero bin quantity, billed-line reference) under the repository's
established lock, per the spec's Slice 2 — including its stop-condition that an incomplete
predicate is a re-spec, not a PR note. The marker at `pos.service.ts:1480` is its ledger entry.

## 5. Proposal drafts for minion-meta `proposals/`

Required by CLAUDE.md's open-items ledger clause. **The factory harness for this run has no
`minion-meta` checkout and forbids pushing outside `minion_hub`,** so the bodies are drafted here
in full for the sweep/operator to file verbatim; each is also anchored by an in-code
`TODO(handoff):` marker, listed below.

### P1 — Wizard cannot reach the service→tracked transition

- **Marker:** `src/routes/api/pos/sellables/[id]/+server.ts`, doc comment on `PATCH`.
- **What:** `SellableWizard.svelte` strips `kind`/`trackStock`/`uom` from its edit-mode PATCH body
  (~~`:214-232`) and renders `m.pos_catalog_kind_locked()` in place of the controls (~~`:331-360`).
  The API now applies the untracked-service→tracked transition and reads `trackStock`/`uom` back,
  so those two behaviours are dead weight and their comments are factually wrong.
- **Why it is not fixed here:** `2026-08-20-handoff-minion-hub-902723699-spec` §5/§7 exclude UI
  work and §8 enforces it with `git diff --quiet <base>...HEAD -- '*.svelte'`.
- **Fix:** on edit, send `trackStock`/`uom` (and `kind`, which the service validates against the
  post-transition state) **only** for the service→tracked case; keep the lock for every case the
  service still refuses (`true→false`, bundles, `uom` with history) so the UI never offers an
  action that 400s. Refresh both stale comments. Gate: the spec's §8 step-5 operator probe.
- **Severity:** medium — the shipped transition has no operator-reachable path, so the approved
  proposal's DoD is only half met.

### P2 — No PostgreSQL integration harness for the concurrency/rollback invariants

- **Marker:** `src/server/services/pos.sellables.test.ts`, on the `item_taken` translation case.
- **What:** two invariants of this spec are proved by _reading_ the schema, not by executing it:
  (a) "exactly one item can link to a sellable" under genuine concurrency, which rests on
  `stk_items_org_fin_product_uniq`
  (`supabase/migrations/20260719230000_stk_items_fin_product_uniq.sql`); and (b) that the shared
  transaction really rolls the item insert back when the `fin_products` rename fails. The unit
  tests prove everything reachable without a database — the writes share one transaction handle
  with no boundary between them, the failure escapes the transaction callback, and 23505 maps to
  `item_taken` — but the abort itself is PostgreSQL's, and no test in this repo executes it.
- **Why it is not fixed here:** the hub suite is vitest-with-mocks end to end; there is no
  integration harness, and per operator memory `hub-supabase-schema-not-reproducible` the schema
  cannot be rebuilt from the monorepo onto an empty database (`organizations`, `flows`,
  `organization_members`, `member_roles` have no `CREATE` anywhere). Standing one up is
  infrastructure work, not a line in this slice.
- **Fix:** an opt-in integration suite against the documented local Supabase stack
  (`supabase/SUPABASE_LOCAL.md`, memory `hub-local-qa-stack-recipe`), seeding an untracked
  service and running two false→true PATCHes behind a barrier, asserting exactly one linked row;
  plus a code-collision case asserting `stk_items` is empty after the 400.
- **Severity:** medium — it is a proof gap, not a known defect; the invariants are enforced by a
  shipped index and a real transaction.
