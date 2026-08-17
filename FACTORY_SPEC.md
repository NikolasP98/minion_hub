---
id: 2026-08-17-hub-updatesellable-silent-drop-spec
title: "updateSellable — apply or refuse kind/trackStock/uom edits (no silent 200 no-op)"
stage: spec
status: approved
pass: 2
created: 2026-08-17
updated: 2026-08-17
proposal: 2026-08-17-hub-updatesellable-silent-drop
verdict: approved
repos: [minion_hub]
tags: [logic, test]
type: fix
---

# updateSellable — apply or refuse kind/trackStock/uom edits

**Owner surface:** `minion_hub` — `src/server/services/pos.service.ts` (`createSellable` /
`updateSellable`), the sellables PATCH route, `pos.sellables.test.ts`
**Design ancestors:** [`2026-07-19-pos-stock-split-implementation-spec`](2026-07-19-pos-stock-split-implementation-spec.md)
(establishes that `kind` is **derived**, and specifies the `itemId` link path in `createSellable`),
[`2026-07-19-item-spine-composition-slice1-spec`](2026-07-19-item-spine-composition-slice1-spec.md)
(the `fin_products` ↔ `stk_items` mirror relation), [`2026-07-25-faces-catalog-cleanup-report`](2026-07-25-faces-catalog-cleanup-report.md)
(names `pos.sellables.test.ts` as the regression home for this area)
**Gate conventions:** [`2026-08-17-sdlc-phase-gates-scoring-spec`](2026-08-17-sdlc-phase-gates-scoring-spec.md) §4b —
per-slice tags below are the routing unit; `logic` slices get mandatory red-state TDD and **no**
UI-governance checks

---

## 0. Product

From the approved proposal `2026-08-17-hub-updatesellable-silent-drop`, verbatim:

> ## Problem
>
> src/server/services/pos.service.ts:1262-1338 — PATCH accepts the fields (SellableWizard sends them)
> but .set() never reads them; operator edits appear to succeed and don't apply.
>
> ## Definition of done
>
> Either the fields apply (mirroring createSellable's item-table sync) or a changed value returns 400;
> test asserts a kind/uom patch is reflected in getSellableRow().
>
> ## Out of scope
>
> Wizard UX changes.

The failure the operator sees: open a sellable in `SellableWizard`, switch it from service to
product (or fix a wrong unit of measure), save, get a green success, reopen — the old value is
back. Silent write loss with a success receipt is worse than an error, because the operator's
mental model of the catalog diverges from the database and stays diverged.

**Why this is not a one-line `.set()` fix.** Per `2026-07-19-pos-stock-split-implementation-spec`
§Findings 2, **`kind` is derived, not stored**: a sellable is `product` iff a `stk_items` row links
back to it via `fin_product_id`. `trackStock` is the *request* to create that mirror row and `uom`
is a column on the mirror, not on `fin_products`. So the three dropped fields are all projections
of a **different table**, which is exactly why `.set()` on `fin_products` could never carry them
and why the drop went unnoticed. The fix is an item-table sync step in `updateSellable`, plus a
policy for the transitions that cannot be applied without rewriting the meaning of history.

## 1. Assumptions — Slice 0 is mandatory

**This spec was written from the meta-repo, where `minion_hub/` is not checked out** (the
meta-repo `.gitignore` excludes every subproject; verified: no `pos.service.ts` on disk here).
Every path, line number and symbol below is carried from the proposal (written today, so strong)
or from the 2026-07-19/2026-07-25 specs (a month old — **line numbers have certainly moved**).
Treat them as leads, not fact. Slice 0 turns them into fact; if something moved, correct §3 of
this spec in the same commit rather than implementing against a different file in silence.

Four carried claims are load-bearing:

1. **`kind` is derived** from the existence of a linked `stk_items` row (`pos.service.ts:654` as
   of 2026-07-19). If a literal `kind` column has since been added to `fin_products`, slices S1–S3
   collapse to a much smaller change — say so in the PR and cut scope, don't implement both models.
2. **`createSellable` already contains the item-sync logic** (`createItem` when `trackStock`;
   `updateItem(ctx, itemId, { finProductId })` when linking an existing item). S2 **extracts** it;
   it does not reimplement it. If no such logic exists, S2 grows and its estimate is wrong.
3. **`PosError(message, code)`** is the service's typed-error convention (precedent:
   `PosError('item already published', 'item_taken')`), and the route maps `PosError` → HTTP 400.
   The proposal's DoD says "returns 400" — if the route currently maps service errors to 500,
   fixing that mapping is **in scope for S1** (it is the difference between a met and an unmet DoD).
4. **`SellableWizard` submits the full object on every save**, including unchanged `kind`,
   `trackStock` and `uom`. This is the trap in this spec: a naive "field present ⇒ 400" rejects
   *every* edit, including a pure price change. Refusal must compare against the **currently
   derived** value, so an unchanged resubmit stays a 200 no-op. See S1.

**Branch discrepancy to settle before branching.** AGENTS.md's project map says hub's branch is
`dev`; `2026-08-13-crm-customers-server-pagination-spec` states `origin/dev` was **deleted** and
the live base is `origin/master`. Run `git -C minion_hub branch -r` and branch off whatever is
actually live. Do not create or resurrect a branch to match the docs.

### Slice 0 — recon (≤ 45 min, prepend to S1, not counted as a slice)

```bash
cd minion_hub
git branch -r                                              # settle the base branch (above)
test -f src/server/services/pos.service.ts
rg -n 'function (create|update)Sellable|getSellableRow' src/server/services/pos.service.ts
rg -n -A40 'function updateSellable' src/server/services/pos.service.ts   # confirm .set() field list
rg -n 'kind' src/server/services/pos.service.ts | rg -n 'stk_items|finProductId|fin_product_id'
rg -n 'SellableInput|SellableUpdate' src/ --type ts        # where the input type lives; who else uses it
rg -rn 'sellables' src/routes/api --files-with-matches     # the PATCH route path
rg -n 'PosError' src/server/services/pos.service.ts | head
rg -n 'PosError|catch' src/routes/api -g '**/sellables/**'  # → confirm PosError maps to 400, not 500
#   (use rg's own -g glob, not a shell **; without `shopt -s globstar` bash passes the literal
#   string through and rg errors on a nonexistent path)
rg -n 'createItem|updateItem' src/server/services/stock.service.ts | head
rg -n 'uom|unitOfMeasure' src/server/db/schema/*.ts | rg -i 'item'   # uom column name + table
rg -n 'stk_ledger|stk_bins|ledger|movement' src/server/db/schema/*.ts | head  # movement tables for S2/S3
test -f src/server/services/pos.sellables.test.ts          # regression home; create if absent
rg -n 'kind|trackStock|uom' src/lib/components/**/SellableWizard.svelte | head  # what the wizard sends
```

Record the actuals in the PR description. Nothing else in Slice 0 changes files.

## 2. Approach — three vertical slices

```
S0 (recon) ─▶ S1 (honest 400) ─▶ S2 (apply the safe transitions) ─▶ S3 (destructive policy + drift guard)
```

Strictly sequential — each slice edits the same function. **S1 alone stops the silent drop** —
every changed `kind`/`trackStock`/`uom` value either no-ops correctly or refuses with a typed 400,
so no operator edit is lost silently — and is safe to ship on its own. S1 does **not** yet satisfy
the proposal's DoD sentence *literally*: "test asserts a kind/uom patch is reflected in
`getSellableRow()`" requires a patch that actually *applies*, and S1 refuses every real kind/uom
change (that's the point of S1). The reflected-patch assertion first becomes true in S2 (see §6
step 2, and S2's DoD's `trackStock:true` case). S2+S3 satisfy the preferred branch ("the fields
apply") and the DoD's literal wording in full. If the pilot wave needs to cut scope, cut after S1
or after S2 — but then the AGENTS.md **open-items ledger** rule applies: a `TODO(handoff):`
comment at the refusal site plus an append to the source proposal saying which transitions are
still refused and why, **and**, if cutting after S1, a note that the proposal's literal DoD
sentence is not yet met (only its safety property is).

---

### S1 — Stop lying: derive current state, no-op on equal, 400 on changed

**Tags:** `logic`, `test` · **Estimate:** 5–6 h

**Goal:** no code path can accept one of these three fields and discard it. Either it matches
what is already true (200 no-op, unchanged behavior for every existing edit) or it is refused with
a typed code. Zero behavior change for price/name/category edits.

**Do:**
- Extract the derivation into one exported pure-ish helper used by *both* read and write paths, so
  the "is this a product?" question has exactly one implementation:
  `deriveSellableFacts(ctx, finProductId): Promise<{ kind: 'service'|'product'; trackStock: boolean; uom: string|null; itemId: string|null }>`.
  Reuse whatever `getSellableRow` / the `:654` derivation already does — **do not add a second
  definition of `kind`**.
- In `updateSellable`, before the `.set()`: for each of `kind`, `trackStock`, `uom` that is
  present in the input, compare to the derived current value under a documented normalization
  (trim + case-fold for `uom`; `undefined`/`null` ⇒ "not submitted", not "set to empty").
  Equal ⇒ ignore. Different ⇒ `throw new PosError(<message>, <code>)`:
  | Field changed | Code |
  |---|---|
  | `kind` | `kind_derived` |
  | `trackStock` | `stock_tracking_immutable` |
  | `uom` | `uom_immutable` |
- Messages are operator-readable and say what to do instead ("kind follows the linked stock item;
  publish or unlink an item to change it") — the wizard renders service errors today and this spec
  does not touch the wizard.
- Confirm/repair the route's `PosError` → **400** mapping (assumption 3). If other endpoints share
  that handler, only widen the mapping for `PosError`; leave unknown errors as 500.
- `TODO(handoff):` at the `trackStock` and `uom` refusal sites only, pointing at S2/S3 of this spec —
  those two are genuinely deferred work and the markers are removed as each slice lands. **Not** at
  the `kind_derived` site: `kind` is derived by design (assumption 1) and is never a directly
  settable field in any slice, including S3 — refusing a direct `kind` write is the permanent,
  correct behavior, not deferred work, so it gets a plain explanatory comment instead of a
  `TODO(handoff)` that would never have a slice to remove it.

**Files:** `src/server/services/pos.service.ts`, the sellables PATCH `+server.ts` (only if the
error mapping needs repair), `src/server/services/pos.sellables.test.ts`.

**Definition of done (machine-checkable):**
```bash
bun run vitest run src/server/services/pos.sellables.test.ts
#   red-state first (G3): each case below must be shown failing before the fix lands
#   - full-object resubmit with UNCHANGED kind/trackStock/uom + a changed price → 200, price applied
#     (this is the wizard's normal save; it must not 400)
#   - uom resubmitted with different case/whitespace only → treated as unchanged → 200
#   - kind 'service'→'product' → throws PosError code 'kind_derived'
#   - trackStock false→true → throws 'stock_tracking_immutable'
#   - uom 'Unidad'→'mL' → throws 'uom_immutable'
#   - none of the above mutates any row (assert getSellableRow() byte-equal before/after the throw)
bun run vitest run src/routes/api            # route: PosError surfaces as HTTP 400, body carries `code`
bun run check                                # 0 errors / 0 warnings
rg -c 'kind.*stk_items|deriveSellableFacts' src/server/services/pos.service.ts  # one derivation, not two
```

---

### S2 — Extract `createSellable`'s item sync and apply the non-destructive transitions

**Tags:** `logic`, `test` · **Estimate:** 6–8 h

**Goal:** the proposal's preferred branch, for every transition that adds information.
`trackStock` false→true and `uom` on a pristine item now actually apply, through the **same code
path** `createSellable` uses — the drift that caused this bug becomes structurally impossible.

**Do:**
- Extract from `createSellable` into `syncSellableItem(tx, ctx, finProductId, desired)`, where
  `desired = { trackStock, uom, itemId? }`. `createSellable` is refactored to call it (behavior
  must be identical — see DoD parity test). No new item-creation code is written in this slice.
- Wire `updateSellable` to call it for the transitions that are safe:
  - `trackStock` **false → true**: create the linked `stk_items` row (`is_stock_item` per the
    existing create path, `fin_product_id` set) using the submitted `uom`. Derived `kind` becomes
    `product` as a consequence — this is what makes the proposal's "kind patch is reflected in
    `getSellableRow()`" assertion pass.
  - `itemId` present (link an existing item), **if** that input field exists per
    `2026-07-19-pos-stock-split-implementation-spec` §Task: reuse its `item_taken` guard verbatim.
  - `uom` change **when the linked item has zero movements** (pristine): apply.
- Add `itemHasHistory(ctx, itemId): Promise<boolean>` — true if any ledger/movement row, non-zero
  bin quantity, or billed line references the item. Table names come from Slice 0. **Fail closed:**
  if any of those queries cannot be written confidently, return `true` (treat as having history) and
  say so in the PR — refusing a legal edit is recoverable, silently reinterpreting stock history is not.
- Remove the S1 `TODO(handoff):` markers for the now-supported transitions; keep the rest.
- Everything runs inside the existing transaction. A failed item insert must roll back the
  `fin_products` update — a sellable that reports `product` with no item is the same class of lie
  this spec exists to remove.

**Files:** `src/server/services/pos.service.ts`, `src/server/services/stock.service.ts` (only if
`createItem` needs a caller-supplied `uom` parameter it lacks), `src/server/services/pos.sellables.test.ts`.

**Definition of done (machine-checkable):**
```bash
bun run vitest run src/server/services/pos.sellables.test.ts
#   - PATCH { trackStock: true, uom: 'Unidad' } on a service sellable →
#       getSellableRow() reports kind 'product', trackStock true, uom 'Unidad'   ← the proposal's DoD
#   - a linked stk_items row exists with fin_product_id == the sellable
#   - PATCH { uom: 'mL' } on a tracked item with NO movements → getSellableRow().uom == 'mL'
#   - PARITY: createSellable({...trackStock:true,uom:'Unidad'}) and
#       createSellable(service) + updateSellable({trackStock:true,uom:'Unidad'}) yield
#       equal getSellableRow() projections and equal item rows (ignoring ids/timestamps)
#   - forced item-insert failure → fin_products row unchanged (transaction rolled back)
#   - itemId already linked elsewhere → PosError 'item_taken'
bun run check
rg -n 'createItem' src/server/services/pos.service.ts   # only inside syncSellableItem, one call site
```

---

### S3 — Destructive-transition policy + the anti-recurrence guard

**Tags:** `logic`, `test` · **Estimate:** 5–6 h

**Goal:** close the two transitions that must not be applied blindly, with reasons an operator can
act on, and leave behind a test that fails if `create` and `update` ever diverge again.

**Do:**
- `trackStock` **true → false**: if `itemHasHistory` ⇒ `PosError(..., 'stock_untrack_has_history')`
  (400). If pristine ⇒ unlink (clear `fin_product_id`; delete the mirror row only if the create path
  is what made it and it is stock-less — otherwise unlink only, never delete a row the operator may
  own). Derived `kind` returns to `service`.
- `uom` change **with** history ⇒ `PosError(..., 'uom_locked_has_history')` (400). Rationale to put
  in the code comment, not just the PR: per `2026-07-19-pos-stock-split-implementation-spec`, one
  stocked `Unidad` *is* a 15 mL vial — historical ledger and bin quantities are recorded in the
  stock UOM and are **not** rewritten, so renaming the unit retroactively falsifies every past
  movement. Conversion (`units_per_stock_uom`) is that spec's job, not this one.
- Anti-recurrence guard: every field of `SellableInput`/`SellableUpdate` is either present in
  `updateSellable`'s `.set()`, handled by `syncSellableItem`, or listed in an explicit
  `INTENTIONALLY_IGNORED` const, and a newly added field that is silently dropped fails this check.
  **How** depends on what Slice 0's `rg 'SellableInput|SellableUpdate'` finds: if it's a runtime
  schema (zod/valibot), write it as a vitest case that reads the schema's own keys at runtime,
  exactly as below. If it's a plain compile-time-only TS type (the likelier case — nothing found so
  far in this codebase's POS/stock services suggests zod-backed inputs), runtime key introspection
  is impossible (TS types are erased); use a **compile-time** coverage check instead — e.g.
  `type _AssertNoUnhandledField = Record<Exclude<keyof SellableUpdate, typeof HANDLED_FIELDS[number] | typeof INTENTIONALLY_IGNORED[number]>, never>` —
  that fails `bun run check` (not vitest) when a field is added and left unclassified. Whichever
  form applies, this is the generalization of the bug and the reason it is worth a slice.
- Remove the last S1 `TODO(handoff):` markers. If any transition is still unsupported at this
  point, it stays as a `TODO(handoff):` **and** an appended entry on the source proposal.

**Files:** `src/server/services/pos.service.ts`,
`src/server/services/pos.sellables.test.ts` (+ a small fixture that seeds a movement row).

**Definition of done (machine-checkable):**
```bash
bun run vitest run src/server/services/pos.sellables.test.ts
#   - untrack a pristine tracked sellable → getSellableRow().kind == 'service', item unlinked
#   - untrack an item WITH a movement → PosError 'stock_untrack_has_history'; row + item unchanged
#   - uom change on an item WITH a movement → PosError 'uom_locked_has_history'; ledger untouched
#   - field-coverage guard, runtime-schema case: adding a dummy field to the input schema without
#     handling it fails this vitest case (const list compared to the schema's own keys)
bun run vitest run                                     # whole hub suite green, no skips added
bun run check
#   - field-coverage guard, plain-TS-type case (see "Do"): the compile-time coverage type is what
#     fails here — check must go red when a dummy field is added and left unclassified, green after
rg -n 'TODO\(handoff\)' src/server/services/pos.service.ts   # only for genuinely deferred work
```

---

## 3. Files touched (consolidated)

| File | Slices | Nature |
|---|---|---|
| `src/server/services/pos.service.ts` | S1, S2, S3 | `deriveSellableFacts`, `syncSellableItem` extraction, `updateSellable` apply/refuse, `itemHasHistory` |
| `src/server/services/pos.sellables.test.ts` | S1, S2, S3 | new cases + movement fixture (create the file if Slice 0 shows it absent) |
| sellables PATCH `+server.ts` (path from Slice 0) | S1 | only if `PosError` → 400 mapping needs repair |
| `src/server/services/stock.service.ts` | S2 | only if `createItem` cannot take a caller-supplied `uom` |

All paths relative to `minion_hub/`. **No `.svelte` file is edited in any slice** — see §5.
No migration: every field involved already has a home (`stk_items`), so this spec ships **zero DDL**.

## 4. Cross-repo impact

Checked against AGENTS.md "Cross-Project Impact Zones". Two zones could plausibly apply — **DB
schema change** (hub → site, shared DB) and **gateway protocol** — and neither does:

| Surface | Impact | Mitigation / evidence |
|---|---|---|
| `minion_site` (shares the DB with hub) | **None.** Zero DDL; no table, column or type touched | CI guard: `git diff --name-only <base>...HEAD \| grep -qE '^(src/server/db/schema/\|supabase/migrations/)' && exit 1` |
| `@minion-stack/db` | **None** — no schema edit ⇒ no version bump, no changeset | same guard |
| `@minion-stack/shared` / gateway WS frames | **None** — service + REST only, no frame type touched | — |
| `packages/*` in this meta-repo | **None** — verified in this checkout: `rg -l 'sellable\|Sellable' packages ops langgraph-server scripts` returns **zero** hits | re-run the grep at PR time |
| `paperclip-minion`, `pixel-agents`, `minion_plugins` | **None** | — |
| `minion/` gateway POS/catalog tools | **Unknown from here** — see ⚠️ A1 | grep in Slice 0 |

### ⚠️ A1 — a new 400 is a behavior change for any non-wizard caller

S1 turns silent success into an error. Any automated caller that today PATCHes a whole sellable
object built from a *stale* read would start failing — correctly, but loudly and possibly at 3 a.m.
Before S1 merges, run across the checked-out siblings:

```bash
rg -n 'sellable|/api/pos/sellables' ~/work/minion ~/work/minion_hub ~/work/paperclip-minion ~/work/packages
```
- Only `SellableWizard` (and tests) call it ⇒ no impact; proceed.
- A gateway tool, importer or seed script also calls it ⇒ paste the list in the PR and re-check that
  it sends `kind`/`trackStock`/`uom` at all. A caller that omits them is unaffected by design
  (omitted ⇒ "not submitted"). A caller that echoes stale values needs a one-line fix in **its** repo,
  filed as its own proposal — do not weaken the refusal to keep a broken caller quiet.

### ⚠️ A2 — the FACES catalog is live data

`2026-07-25-faces-catalog-cleanup-report` did a large sellable/item cleanup on the FACES org.
Untracking (S3) mutates `fin_product_id` on real rows. Do all S2/S3 manual probing against the dev
org, never production, and keep the pristine-only rule: if `itemHasHistory` is uncertain, it
returns `true` and the edit is refused.

## 5. Out of scope (explicit)

- **Wizard UX changes** (the proposal's own exclusion). No `.svelte` file is touched: no new error
  UI, no disabled toggles, no "this can't be changed" hints. The wizard renders whatever the
  service error surface already renders. Improving that presentation — including showing *why* a
  UOM is locked — is a follow-up proposal, and because no UI file changes, the `ui` tag and its
  governance gates (`lint:design` / `lint:tokens`, ui-design-governance skill) do **not** apply to
  this spec per `2026-08-17-sdlc-phase-gates-scoring-spec` §4b.
- **UOM conversion semantics** (`consumption_uom`, `units_per_stock_uom`, the 10 mL/15 mL vial
  arithmetic). Owned by `2026-07-19-pos-stock-split-implementation-spec`. This spec only refuses
  the unsafe rename; it never converts quantities and never rewrites ledger rows.
- **Recipes / `stk_consumption` / the item-composition graph** — `2026-07-19-item-spine-composition-slice1-spec`.
- **Schema changes.** No new table, column or type; no migration file. If a slice appears to need
  one, stop and re-spec — that is a different, larger piece of work.
- **Backfilling or repairing sellables already corrupted by the silent drop.** Unknown how many
  exist; a detection query plus a repair plan is its own proposal. If S0/S2 makes the count easy to
  obtain, put the number in the PR so that proposal can be written with real data.
- **Other `pos.service.ts` debt from the same sweep** — `2026-08-17-hub-pos-appointments-fork`,
  `2026-08-17-hub-igv-rate-from-org-config`. Different functions; scope commits narrowly and expect
  to rebase (`pos.service.ts` is a contended file).
- **Deleting stock items on untrack.** S3 unlinks; it does not delete operator-owned rows.

## 6. End-to-end verification

Run with all three slices merged, on the live hub base branch confirmed in Slice 0, dev org.

```bash
cd minion_hub

# 1. Gates (logic-tagged: no design/token lint required — see §5)
bun run check                                   # 0 errors / 0 warnings
bun run vitest run                              # full suite green; no new skips
bun run vitest run src/server/services/pos.sellables.test.ts
git diff --name-only <base>...HEAD | grep -E '\.svelte$'            && echo "FAIL: UI out of scope" && exit 1
git diff --name-only <base>...HEAD | grep -E '^supabase/migrations' && echo "FAIL: no DDL in this spec" && exit 1

# 2. The proposal's DoD, end to end against a running dev server
#    (S=sellable id of a service-kind sellable with no linked item)
curl -s -X PATCH "$HUB/api/pos/sellables/$S" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"trackStock":true,"uom":"Unidad"}' | jq -e '.ok == true'
curl -s "$HUB/api/pos/sellables/$S" -H "$AUTH" \
  | jq -e '.kind=="product" and .trackStock==true and .uom=="Unidad"'   # reflected in getSellableRow()

# 3. Refusals are 400 with an actionable code (not 500, not 200)
#    (T=sellable whose linked item HAS ledger movements)
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH "$HUB/api/pos/sellables/$T" -H "$AUTH" \
  -H 'content-type: application/json' -d '{"uom":"mL"}'                 # 400
curl -s -X PATCH "$HUB/api/pos/sellables/$T" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"uom":"mL"}' | jq -e '.code=="uom_locked_has_history"'
curl -s -X PATCH "$HUB/api/pos/sellables/$T" -H "$AUTH" -H 'content-type: application/json' \
  -d '{"trackStock":false}' | jq -e '.code=="stock_untrack_has_history"'

# 4. The regression that started it all: no silent success
#    Patch a changed value, then re-read. The two outcomes are the ONLY legal ones:
#      (a) HTTP 200 and the re-read shows the new value, or
#      (b) HTTP 400 and the re-read shows the old value.
#    HTTP 200 + unchanged re-read is the bug and must be unreachable for all three fields.

# 5. Operator probe (browser-harness skill; no UI edits, verification only)
#    - open the wizard on a service sellable, tick stock tracking, set UOM, save
#    - reopen → the values persist (before this spec they silently reverted)
#    - on a sellable with stock history, change the UOM and save → the wizard shows the
#      service error rather than a green success
```

**Ship gate:** §6 all green, the proposal's DoD sentence checked off literally (a `kind`/`uom`
patch reflected in `getSellableRow()` — step 2), A1's consumer grep pasted into the PR, and Slice
0's recorded actuals reconciled against §3 (any correction committed to this spec in the same PR).
