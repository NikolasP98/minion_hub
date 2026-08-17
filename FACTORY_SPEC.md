---
id: 2026-08-17-hub-igv-rate-from-org-config-spec
title: "SUNAT emission — thread the org's configured IGV rate (no module-level 0.18)"
stage: spec
status: approved
pass: 2
created: 2026-08-17
updated: 2026-08-17
proposal: 2026-08-17-hub-igv-rate-from-org-config
verdict: approved
repos: [minion_hub]
tags: [logic, test]
type: fix
---

# SUNAT emission — thread the org's configured IGV rate

**Owner surface:** `minion_hub` — `src/server/finance/emission/` (`ubl.ts`, `types.ts`,
`summary.ts`, `index.ts`), `src/server/services/pos-emission.service.ts`,
`src/server/services/finance.service.ts` or a new `src/server/finance/tax.ts` (S2's
`resolveIgvRate` boundary — see §3), the emission unit tests and the three live-beta scripts
**Design ancestors:** [`2026-08-14-sunat-emission-beta-spec`](2026-08-14-sunat-emission-beta-spec.md)
(created `emission/`, defines `EmissionInvoice` and states "totals/IGV are DERIVED (18%, inclusive
prices), never passed in" — this spec revises exactly that sentence),
[`2026-08-14-sunat-resumen-baja-spec`](2026-08-14-sunat-resumen-baja-spec.md) (`summary.ts` re-derives
per-boleta gravada + IGV — the second home of the hardcoded rate),
[`2026-08-14-pos-shadow-emission-spec`](2026-08-14-pos-shadow-emission-spec.md)
(`ticketToEmission` — the only production caller, and where the org's settings are already in hand),
[`2026-08-14-sunat-source-ui-spec`](2026-08-14-sunat-source-ui-spec.md) (the `/finances/settings`
page, deliberately *not* touched here — see §5)
**Gate conventions:** [`2026-08-17-sdlc-phase-gates-scoring-spec`](2026-08-17-sdlc-phase-gates-scoring-spec.md) §4b —
every slice below is tagged `logic`/`test`: mandatory red-state TDD, **no** UI-governance checks

---

## 0. Product

From the approved proposal `2026-08-17-hub-igv-rate-from-org-config`, verbatim:

> ## Problem
>
> src/server/finance/emission/ubl.ts:5 const IGV_RATE = 0.18 while finSettings.taxRate
> (finance.service.ts:386) is already per-org configurable — emission ignores it. Any org with a
> different rate emits wrong SUNAT documents.
>
> ## Definition of done
>
> computeTotals()/EmissionInvoice thread the org taxRate; unit test asserts a non-0.18 rate changes
> output; grep confirms no module-level rate constant remains.
>
> ## Out of scope
>
> Tax-inclusive/exclusive pricing semantics changes.

**Why this is worth three slices and not a find-and-replace.** The constant is not a magic number
sitting in one expression — it is a *design assumption* that `2026-08-14-sunat-emission-beta-spec`
wrote down on purpose ("totals/IGV are DERIVED (18%, inclusive prices), **never passed in**"). It
therefore leaks into at least four places that must move together:

1. `computeTotals()` in `ubl.ts` — the divisor that turns an IGV-inclusive POS price into a net
   value (`valorVenta = totalIncl / (1 + rate)`).
2. The UBL `cbc:Percent` element inside `TaxCategory` — a *literal* `18` in the XML. Deriving
   totals at 10% while still declaring `Percent 18` produces a document that SUNAT rejects on
   arithmetic, which is a louder failure than the one we are fixing but still a failure.
3. `summary.ts` (resumen diario) — per-boleta `gravada + IGV + total` are recomputed there for the
   RC document. The proposal's grep ("no module-level rate constant remains") only passes if this
   second copy is found too.
4. The **rounding strategy**. At 18% the current strategy is proven — the shipped specs' DoD was a
   live `ResponseCode 0` from SUNAT's real validator. Nothing proves it survives 10% or 8%, where
   `totalIncl / 1.10` lands on different half-cent boundaries. A rate change that yields
   `sum(lines) != totals` is rejected by SUNAT ("totales no consistentes"), so the rate parameter is
   only genuinely done when the consistency invariant holds *for every supported rate*, not just for
   the one we happened to build against.

The user-visible failure today: an org configures a non-18% tax rate in `fin_settings`, believes it
applies, and every document minion emits for it is arithmetically wrong — silently, because
SUNAT accepts an internally-consistent 18% document regardless of what the org's books say.

## 1. Assumptions — Slice 0 is mandatory

**This spec was written from the meta-repo, where `minion_hub/` is not checked out** (the meta-repo
`.gitignore` excludes every subproject; verified on disk: no `src/server/finance/emission/` here).
Every path, line number and symbol below is carried from the proposal (written today — strong) or
from the 2026-08-14 emission specs (three days old, and all three are `status: shipped`, so the
files exist but line numbers have moved). Treat them as leads, not fact. Slice 0 turns them into
fact; if something moved, correct §3 of this spec in the same commit rather than implementing
against a different file in silence.

Five carried claims are load-bearing:

1. **`ubl.ts` exports/contains `computeTotals()`** and a module-level `const IGV_RATE = 0.18`
   (proposal, line 5). The proposal names `computeTotals()` explicitly, so it exists as a distinct
   function — S1 changes its signature.
2. **`finSettings.taxRate` already exists and is per-org configurable** (proposal, `finance.service.ts:386`).
   **Its unit is unknown from here** — `18` (percent) and `0.18` (fraction) are both plausible, and
   `null`/absent is plausible for orgs that never touched the setting. Getting this wrong makes
   every document off by two orders of magnitude, so Slice 0 settles it with a real query, not by
   reading a type. See ⚠️ A1.
3. **`ticketToEmission(ticket, lines, customer, settings)` in `pos-emission.service.ts`** already
   receives the org's POS settings and runs inside an org-scoped context — so the rate is reachable
   without plumbing a new context argument through `submitTicket`. If `settings` there is
   `pos_settings` only and `fin_settings` needs a separate fetch, S2 grows by one query, not by a
   refactor.
4. **`summary.ts` recomputes per-boleta IGV** (per `2026-08-14-sunat-resumen-baja-spec` §1: "per-boleta
   totals (gravada + IGV + total)"). Whether it imports `IGV_RATE` from `ubl.ts`, redeclares it, or
   receives pre-computed totals from the caller is unknown — S3's scope depends on the answer.
5. **Three live-beta scripts exist** (`scripts/emit-beta-test.ts`, `scripts/shadow-emit-test.ts`,
   `scripts/summary-beta-test.ts`) and construct `EmissionInvoice` literals. Any required new field
   breaks them at compile time — that is desirable (it is how we find every construction site), but
   it means S1 must fix them in the same commit or `bun run check` is red.

**Branch discrepancy to settle before branching.** AGENTS.md's project map says hub's branch is
`dev`; `2026-08-13-crm-customers-server-pagination-spec` states `origin/dev` was **deleted** and the
live base is `origin/master` (the 2026-08-14 emission specs' design-lint commands also use
`DESIGN_LINT_BASE_REF=origin/master`). Run `git -C minion_hub branch -r` and branch off whatever is
actually live. Do not create or resurrect a branch to match the docs.

### Slice 0 — recon (≤ 45 min, prepend to S1, not counted as a slice)

```bash
cd minion_hub
git branch -r                                                   # settle the base branch (above)
ls src/server/finance/emission/                                 # confirm the file inventory of §3
rg -n 'IGV_RATE|0\.18|\b18\b' src/server/finance/emission/      # EVERY hardcoded-rate site, incl. cbc:Percent
rg -n -A25 'function computeTotals' src/server/finance/emission/ubl.ts   # signature + rounding strategy
rg -n 'Percent|TaxCategory|TaxScheme' src/server/finance/emission/*.ts   # where 18 is written into the XML
rg -n 'EmissionInvoice' src/ scripts/ --type ts                 # every construction site (scripts included)
rg -n -B5 -A20 'taxRate' src/server/services/finance.service.ts # unit, default, null-handling  ← A1
rg -n 'taxRate|tax_rate' src/server/db/schema/ supabase/migrations/  # column vs jsonb key; nullable?
rg -n -A30 'function ticketToEmission' src/server/services/pos-emission.service.ts  # what `settings` holds
rg -n 'getFinSettings|finSettings' src/server/services/*.ts | head       # the existing read helper
rg -n 'gravada|igv|Igv|IGV' src/server/finance/emission/summary.ts       # assumption 4
ls src/server/finance/emission/*.test.ts src/server/**/emission*.test.ts 2>/dev/null  # test home
# A1, the decisive one — read real data, do not infer from types:
#   select org_id, tax_rate from fin_settings;   (dev DB, via bun run db:studio or psql)
```

Record the actuals — **especially the unit of `taxRate` and the set of values live orgs have** — in
the PR description. Nothing in Slice 0 changes files.

## 2. Approach — three vertical slices

```
S0 (recon) ─▶ S1 (rate becomes a required input) ─▶ S2 (org config feeds it) ─▶ S3 (summary + validation + guard)
```

Strictly sequential — S1 changes a type that S2 populates and S3 sweeps. **S1+S2 together satisfy
the proposal's DoD sentence** ("computeTotals()/EmissionInvoice thread the org taxRate; unit test
asserts a non-0.18 rate changes output"); S3 delivers its third clause ("grep confirms no
module-level rate constant remains") plus the rounding invariant that makes non-18% rates actually
safe to emit. If the pilot wave cuts scope, cut after S2 — but then the AGENTS.md **open-items
ledger** rule applies: a `TODO(handoff):` at each remaining hardcoded site plus an append to the
source proposal naming which paths still assume 18%.

---

### S1 — The rate becomes a required input of the emission library

**Tags:** `logic`, `test` · **Estimate:** 5–7 h

**Goal:** it becomes *impossible* to build an emission document without stating a rate. No default,
no fallback, no module-level constant anywhere under `emission/`. Behavior at 18% is byte-identical
to today — this slice is a pure signature change plus tests, verified by a golden-XML comparison.

**Do:**
- Add `igvRate: number` to `EmissionInvoice` in `types.ts` — **required, a fraction** (`0.18`, not
  `18`), documented in a doc-comment that says so in one line and points at the normalization helper
  from S2. One representation inside the library; conversion happens exactly once, at the boundary
  (S2). Name it `igvRate` rather than `taxRate` so a mis-wired *percent* value from settings is a
  grep-visible mismatch rather than a silent one.
- `computeTotals(inv)` (or `computeTotals(lines, igvRate)` — keep whichever shape it has, just make
  the rate an argument) reads the rate from its input. Delete `const IGV_RATE`.
- Thread the same value into the XML's declared `cbc:Percent` (`rate * 100`, formatted to at most
  2 decimals, trailing zeros per the existing formatter). **The declared percent and the divisor
  must come from one variable** — that they can disagree is the second bug hiding inside the first.
- Update every construction site found in S0 to pass `0.18` explicitly: `pos-emission.service.ts`
  (`ticketToEmission` — a literal here for now; S2 replaces it), the three `scripts/*.ts`, all
  existing tests and fixtures. This slice deliberately does **not** read settings — keeping the
  signature change and the behavior change in separate commits is what makes the golden-XML check
  below meaningful.
- `TODO(handoff): rate is still a literal here — S2 of 2026-08-17-hub-igv-rate-from-org-config-spec
  reads it from fin_settings` at the `ticketToEmission` call site, removed by S2.
- **Do not touch the rounding strategy in this slice.** Non-18% rounding is S3's problem; changing
  both at once destroys the golden-XML parity signal.

**Files:** `src/server/finance/emission/types.ts`, `src/server/finance/emission/ubl.ts`,
`src/server/finance/emission/index.ts` (only if orchestrator signatures carry the invoice through),
`src/server/services/pos-emission.service.ts`, `scripts/emit-beta-test.ts`,
`scripts/shadow-emit-test.ts`, `scripts/summary-beta-test.ts`, the emission test file(s) from S0.

**Definition of done (machine-checkable):**
```bash
bun run vitest run src/server/finance/emission
#   red-state first (G3): each case shown failing before the fix lands
#   - GOLDEN PARITY: buildInvoiceXml(fixture with igvRate 0.18) is byte-equal to a golden XML
#     snapshot captured from the pre-change code (commit the snapshot in this slice)
#   - igvRate 0.10 on the SAME fixture → total IGV, valorVenta and cbc:Percent ALL differ from the
#     0.18 output   ← the proposal's "unit test asserts a non-0.18 rate changes output"
#   - cbc:Percent in the emitted XML == igvRate * 100 for each of {0.18, 0.10, 0.08}
#   - omitting igvRate is a TYPE error (assert via a // @ts-expect-error line in the test file)
bun run check                                   # 0 errors / 0 warnings — proves every script/caller was updated
rg -n 'IGV_RATE|0\.18' src/server/finance/emission/ --glob '!*.test.ts'   # → zero hits (constant is gone
                                                         #   from the library; the --glob exclusion is load-
                                                         #   bearing — this slice's own golden-parity test
                                                         #   necessarily writes `igvRate: 0.18` literally, so
                                                         #   without it this check fails against its own DoD)
rg -c 'igvRate' src/server/finance/emission/types.ts    # → the field exists
```

---

### S2 — `fin_settings.taxRate` reaches the emitter

**Tags:** `logic`, `test` · **Estimate:** 4–6 h

**Goal:** the proposal's headline. The rate an org configured is the rate its documents carry —
with one normalization, one validation, and one documented fallback, all outside the emission
library.

**Do:**
- Add `resolveIgvRate(finSettings): number` to the **finance/settings layer** (`finance.service.ts`
  or a small `finance/tax.ts` — *not* under `emission/`, so the proposal's grep stays clean). It is
  the single place that:
  - **Normalizes the unit** per S0's A1 finding. If the stored unit is percent, convert
    (`taxRate / 100`). Write the S0 evidence into the code comment — a future reader must not have
    to re-derive it. Do **not** implement a "guess by magnitude" heuristic (`> 1 ⇒ percent`): it is
    exactly the kind of clever that turns a data-entry typo into a valid-looking document.
  - **Validates**: finite, `0 < rate < 1` after normalization. Out of range ⇒ throw
    `PosError('configured tax rate is not usable for SUNAT emission', 'invalid_tax_rate')` (the
    house typed-error convention; route mapping is already whatever `pos-emission` uses — do not
    change it). **`rate === 0` throws too** — see ⚠️ A2; a zero-rated document is a different UBL
    document, not a 0% version of this one.
  - **Falls back** when `taxRate` is null/absent: `DEFAULT_IGV_RATE = 0.18` lives *here*, named,
    with a comment saying it is the Peru statutory rate and the pre-existing behavior for orgs that
    never configured one. This keeps every currently-shadow-emitting org bit-identical after this
    slice — a silent behavior change for existing orgs is not in the proposal's scope.
- Wire it in `ticketToEmission`: read the org's fin settings (via the existing helper found in S0 —
  reuse it, do not write a second query) and set `igvRate` on the returned `EmissionInvoice`.
  Remove S1's `TODO(handoff):`.
- If `ticketToEmission` is pure/synchronous and cannot fetch, take the rate as a parameter and
  resolve it in its caller inside `submitTicket`'s existing settings read — **do not** make a
  mapping function do I/O just to avoid a signature change.
- The three `scripts/*.ts` keep their explicit literal rate (they are synthetic-payload harnesses
  with no org) — but read it from a CLI arg defaulting to `0.18`, so S3's live run can exercise a
  non-18% document against SUNAT without editing code.

**Files:** `src/server/services/finance.service.ts` (or new `src/server/finance/tax.ts`),
`src/server/services/pos-emission.service.ts`, `scripts/emit-beta-test.ts`,
`scripts/shadow-emit-test.ts`, the emission/pos-emission test file(s).

**Definition of done (machine-checkable):**
```bash
bun run vitest run src/server/services/pos-emission   # or wherever S0 placed the mapping tests
#   - org with taxRate configured to the non-18% value → ticketToEmission().igvRate == that fraction
#     and buildInvoiceXml of it declares the matching cbc:Percent   ← the proposal's DoD, end to end
#   - org with taxRate null/absent → igvRate == DEFAULT_IGV_RATE (0.18); output byte-equal to the
#     S1 golden snapshot (proof of zero regression for every org emitting today)
#   - the unit-normalization case from S0 (e.g. stored 18 → 0.18), asserted against the ACTUAL
#     storage unit found in S0, not both
#   - taxRate 0 → throws PosError 'invalid_tax_rate'      (⚠️ A2)
#   - taxRate 1.8 / -0.1 / NaN → throws PosError 'invalid_tax_rate'
bun run check
rg -n '0\.18|DEFAULT_IGV_RATE' src/server/ | grep -v -E 'finance/tax\.ts|finance\.service\.ts|\.test\.ts'
#   → zero hits: exactly one default, in the settings layer
```

---

### S3 — Resumen path, rounding invariant, and the anti-recurrence guard

**Tags:** `logic`, `test` · **Estimate:** 5–7 h

**Goal:** the proposal's third DoD clause, honestly. Every document type the library emits carries
the org's rate; the totals-consistency invariant SUNAT enforces holds at *every* supported rate, not
just 18%; and a test fails if anyone reintroduces a hardcoded rate.

**Do:**
- **`summary.ts` (RC resumen diario):** per assumption 4, thread the rate the same way — either the
  per-boleta totals arrive pre-computed from the caller (preferred: one arithmetic implementation,
  reused via the `ubl-common.ts` seam `2026-08-14-sunat-resumen-baja-spec` §1 already contemplated),
  or `buildResumenXml` takes the rate explicitly. Do not leave a second divisor in the codebase.
  `buildBajaXml` (RA/voided) carries no totals — confirm in S0 and, if so, touch nothing there.
- **Rounding invariant.** Add a table-driven test over rates {0.18, 0.10, 0.08, 0.05} × line sets
  {1 line, 3 lines with odd céntimos (reuse the existing beta-spec fixture), 1 line × quantity 7,
  a line whose inclusive price is an exact multiple of the divisor} asserting, for every cell:
  `sum(line valorVenta) == document valorVenta`, `sum(line IGV) == document IGV`, and
  `valorVenta + IGV == total incl` — all at 2 decimals, exactly, no tolerance. If a cell fails,
  **fix the arithmetic** (canonical fix: derive `net = round2(totalIncl / (1 + rate))` then
  `igv = totalIncl - net` so the pair sums by construction, rather than rounding both independently)
  and say so in the PR: it is a real bug the constant was hiding, and it is the difference between
  "the rate is configurable" and "the rate is configurable *and the document is accepted*".
- **Anti-recurrence guard:** a test that greps the emission source (read the directory, assert on
  contents) for a numeric literal matching a tax rate (`0.18`, `18` adjacent to `Percent`/`IGV`/
  `rate`) outside of test fixtures, and fails with a message pointing at `resolveIgvRate`. This is
  the mechanical form of the proposal's "grep confirms no module-level rate constant remains" —
  a grep in a spec is a one-time check; a grep in a test is a permanent one.
- **Live beta re-verification.** The 18%→parameterized change alters the `Percent` element and
  possibly line rounding, and the shipped specs' DoD was SUNAT's own validator returning
  `ResponseCode 0`. Re-run the two live scripts (§6 step 3) — at 18% *and* at 10% — and paste the
  four CDR descriptions into the PR. A green unit suite with a rejected document is not done.
- Any transition still unsupported (e.g. exonerated/inafecta per A2) leaves a `TODO(handoff):` **and**
  an appended entry on the source proposal.

**Files:** `src/server/finance/emission/summary.ts`, `src/server/finance/emission/ubl-common.ts`
(create only if S0 shows the arithmetic is genuinely duplicated), `src/server/finance/emission/ubl.ts`
(rounding fix, if the table finds one), the emission test file(s), `scripts/summary-beta-test.ts`.

**Definition of done (machine-checkable):**
```bash
bun run vitest run src/server/finance/emission
#   - rate × line-set table above: all cells exact, no tolerance, at all four rates
#   - buildResumenXml with igvRate 0.10 → per-boleta gravada/IGV differ from the 0.18 output and
#     each boleta's gravada + IGV == its total
#   - guard test: adding `const R = 0.18` to ubl.ts makes the suite fail (verify by doing it once,
#     locally, then reverting — state in the PR that you did)
bun run vitest run                              # full hub suite green; no new skips
bun run check                                   # 0/0
rg -n 'IGV_RATE|0\.18' src/server/finance/emission/ --glob '!*.test.ts'   # → zero hits (proposal DoD)
rg -n 'TODO\(handoff\)' src/server/finance/emission/ src/server/services/pos-emission.service.ts
#   → only genuinely deferred work (A2), each with a proposal entry
```

---

## 3. Files touched (consolidated)

| File | Slices | Nature |
|---|---|---|
| `src/server/finance/emission/types.ts` | S1 | `igvRate: number` required on `EmissionInvoice` |
| `src/server/finance/emission/ubl.ts` | S1, S3 | delete `IGV_RATE`; `computeTotals` + `cbc:Percent` take the rate; rounding fix if the S3 table demands one |
| `src/server/finance/emission/summary.ts` | S3 | resumen per-boleta totals use the threaded rate |
| `src/server/finance/emission/index.ts` | S1 | signature pass-through only, if the orchestrators carry the invoice |
| `src/server/finance/emission/ubl-common.ts` | S3 | **only if** S0 proves the arithmetic is duplicated |
| `src/server/services/finance.service.ts` *or* `src/server/finance/tax.ts` | S2 | `resolveIgvRate` + `DEFAULT_IGV_RATE` + validation — the single normalization boundary |
| `src/server/services/pos-emission.service.ts` | S1, S2 | literal → resolved org rate in `ticketToEmission` |
| `scripts/emit-beta-test.ts`, `scripts/shadow-emit-test.ts`, `scripts/summary-beta-test.ts` | S1, S2, S3 | compile fix, then `--rate` CLI arg for the live non-18% run |
| emission + pos-emission test files (paths from S0) | S1, S2, S3 | golden snapshot, rate cases, rounding table, guard test |

All paths relative to `minion_hub/`. **No `.svelte` file is edited in any slice** — see §5.
**Zero DDL**: `fin_settings.taxRate` already exists (that is the whole premise of the proposal), so
this spec ships no migration.

## 4. Cross-repo impact

Checked against AGENTS.md "Cross-Project Impact Zones". Three zones could plausibly apply — **DB
schema change** (hub → site, shared DB), **gateway protocol**, and **shared packages** — and none
of them do:

| Surface | Impact | Mitigation / evidence |
|---|---|---|
| `minion_site` (shares the DB with hub) | **None.** Read-only use of an existing column; zero DDL; no table, column or type touched | CI guard: `git diff --name-only <base>...HEAD \| grep -qE '^(src/server/db/schema/\|supabase/migrations/)' && exit 1` |
| `@minion-stack/db` | **None** — no schema edit ⇒ no version bump, no changeset | same guard |
| `@minion-stack/shared` / gateway WS frames | **None** — server-side library + service only; no frame type, no REST contract change (`EmissionInvoice` is an internal type, never serialized over the wire) | `rg -n 'EmissionInvoice' src/routes/` → expect zero |
| `packages/*` in this meta-repo | **None** — verified in this checkout: `grep -ril 'emission\|igv\|taxrate' packages ops langgraph-server scripts supabase` returns one false positive (`packages/shared/src/gateway/cache-events.ts:20`, the word "Emission timestamp") and nothing else | re-run the grep at PR time |
| `paperclip-minion`, `pixel-agents`, `minion_plugins`, `Minion Docs/` | **None** | — |
| `minion/` gateway POS/finance tools | **Unknown from here** — see ⚠️ A3 | grep in Slice 0 |

### ⚠️ A1 — the unit of `taxRate` is the one thing that must not be guessed

`18` and `0.18` are both idiomatic and both plausible for a column named `taxRate`. Picking wrong
produces documents off by 100×, and — because the library derives totals from *inclusive* prices —
a wrong-unit rate still yields an internally-consistent document that SUNAT **accepts**. There is no
downstream error to catch it. Slice 0 settles it by reading real rows from the dev DB and, if the
column is nullable or sparsely populated, by reading the writer (`/finances/settings` PUT handler or
whatever sets it) to see what the UI stores. Record both in the PR. If the two disagree — i.e. live
data contains a mix of `18` and `0.18` — **stop and escalate**: that is a data-repair proposal, not
something S2 should paper over with a heuristic.

### ⚠️ A2 — a 0% rate is a different document, and this spec refuses it

SUNAT models exonerated (`exonerado`) and unaffected (`inafecto`) operations with different tax
category / scheme codes (the 9997/9998 family) and different `LegalMonetaryTotal` buckets — not as
an IGV line with `Percent 0`. Emitting `Percent 0` under the gravada scheme is a malformed document.
So `resolveIgvRate` **throws** on 0 rather than emitting one, and the exonerated/inafecta document
shape is explicitly out of scope (§5). Consequence to state plainly: an org that has (or later sets)
`taxRate = 0` will get a hard `invalid_tax_rate` error at emission time instead of a silently wrong
document. In shadow mode that surfaces as a `pos_emissions` row with `status='error'` and never
blocks checkout (per `2026-08-14-pos-shadow-emission-spec` §3 "Never block checkout" and §4's
build→sign→send→parse→update-row-to-accepted/rejected/error task) — verify that claim in S2 and, if any
path lets an emission error propagate into the cashier's request, fix *that* here; it would make an
honest error worse than the silent bug.

### ⚠️ A3 — find every emitter before S1 lands

S1 makes `igvRate` required, which is a compile-time break for every construction site. In-repo
sites are caught by `bun run check`; sites in sibling repos are not. Before S1 merges:

```bash
rg -n 'EmissionInvoice|emitToBeta|buildInvoiceXml|submitResumen|ticketToEmission' \
   ~/work/minion ~/work/minion_hub ~/work/paperclip-minion ~/work/packages
```
- Hits only inside `minion_hub` ⇒ no impact; proceed.
- A gateway tool or paperclip adapter constructs emission payloads ⇒ paste the list in the PR; that
  caller needs its own proposal in its own repo. Do **not** make `igvRate` optional-with-default to
  keep a foreign caller compiling — an optional rate is the bug this spec exists to delete.

## 5. Out of scope (explicit)

- **Tax-inclusive/exclusive pricing semantics** (the proposal's own exclusion). POS prices stay
  IGV-inclusive; the library keeps deriving net from the inclusive total. Only the divisor becomes a
  parameter. *Alert, not a scope change:* at a different rate the same displayed price implies a
  different net revenue — a real accounting consequence for the org, worth one sentence in the PR so
  whoever flips a rate is not surprised. This spec does not restate, migrate or reprice anything.
- **Exonerado / inafecto / gratuita document shapes** (SUNAT 9997/9998 codes, per-line tax
  affectation types). A2 refuses them loudly; building them is a separate feature spec.
- **Per-line or per-product tax rates.** One rate per document, from org settings. Mixed-affectation
  invoices are the same future feature as the bullet above.
- **A settings UI for the rate.** `/finances/settings` is untouched; `2026-08-14-sunat-source-ui-spec`
  owns that page. No `.svelte` file changes in any slice ⇒ the `ui` tag and its governance gates
  (`lint:design` / `lint:tokens`, the ui-design-governance skill) do **not** apply to this spec, per
  `2026-08-17-sdlc-phase-gates-scoring-spec` §4b. If S0 finds the rate has *no* UI at all, that is a
  follow-up proposal, not a slice here.
- **Schema changes.** No column, table or migration. If a slice appears to need one, stop and
  re-spec — `taxRate` already existing is the proposal's premise, and if it turns out not to exist,
  this is a different (larger) piece of work touching the hub↔site shared DB.
- **Retro-correcting documents already emitted at 18% for a non-18% org.** Unknown how many exist
  (all beta/shadow so far — nothing legally binding per the emission specs). If S0/S2 makes the
  count cheap to obtain, put the number in the PR so that proposal can be written with real data.
- **Production emission cutover, resumen scheduling, retry/queue machinery, notas de crédito** —
  owned by the 2026-08-14 emission specs and their successors.
- **Other emission/POS debt from the same sweep** — `2026-08-17-hub-updatesellable-silent-drop`,
  `2026-08-17-hub-pos-appointments-fork`. `pos-emission.service.ts` and `pos.service.ts` are
  contended files; scope commits narrowly and expect to rebase.

## 6. End-to-end verification

Run with all three slices merged, on the live hub base branch confirmed in Slice 0, dev org.

```bash
cd minion_hub

# 1. Gates (logic-tagged: no design/token lint required — see §5)
bun run check                                   # 0 errors / 0 warnings
bun run vitest run                              # full suite green; no new skips
git diff --name-only <base>...HEAD | grep -E '\.svelte$'            && echo "FAIL: UI out of scope" && exit 1
git diff --name-only <base>...HEAD | grep -E '^supabase/migrations' && echo "FAIL: no DDL in this spec" && exit 1

# 2. The proposal's DoD, literally
rg -n 'IGV_RATE|0\.18' src/server/finance/emission/ --glob '!*.test.ts'   # → zero hits
rg -n 'igvRate' src/server/finance/emission/types.ts                      # → the threaded field

# 3. SUNAT's own validator still accepts what we build (the shipped specs' DoD, re-run)
bun scripts/emit-beta-test.ts --rate 0.18       # boleta B999-x + factura F999-x → ResponseCode 0
bun scripts/emit-beta-test.ts --rate 0.10       # SAME, at a non-statutory rate → ResponseCode 0
bun scripts/summary-beta-test.ts --rate 0.10    # RC resumen with the 0.10 boletas → ResponseCode 0
#    Paste all CDR descriptions into the PR. A rejection here (e.g. "totales no consistentes")
#    means S3's rounding invariant is incomplete — fix it, do not retry at 18% and call it green.

# 4. Org config actually drives a real ticket (shadow mode, dev org — never production)
#    a. set the dev org's fin_settings taxRate to the non-18% value (in the unit S0 established)
#    b. close a POS ticket with 3 lines and odd céntimos
#    c. read the emission back:
curl -s "$HUB/api/pos/tickets/$T" -H "$AUTH" | jq '.emissions[-1]'   # status accepted, ResponseCode 0
#    d. assert the emitted document's IGV equals total * rate/(1+rate) rounded to 2dp — NOT the 18%
#       figure. This is the whole spec in one assertion.
#    e. restore the dev org's taxRate.

# 5. Zero-regression proof for orgs that never configured a rate
#    An org with taxRate null emits a document byte-equal to the S1 golden snapshot.
```

**Ship gate:** §6 all green, the proposal's DoD sentence checked off clause by clause (threading —
step 2; non-0.18 changes output — step 4d; grep clean — step 2), A1's storage-unit evidence and
A3's consumer grep pasted into the PR, both live CDR sets pasted, and Slice 0's recorded actuals
reconciled against §3 (any correction committed to this spec in the same PR).
