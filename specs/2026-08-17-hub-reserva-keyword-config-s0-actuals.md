---
id: 2026-08-17-hub-reserva-keyword-config-s0-actuals
title: 'S0 actuals + implementation amendments — CRM deposit-rule org config'
stage: spec
status: complete
created: 2026-08-20
updated: 2026-08-29
spec: 2026-08-17-hub-reserva-keyword-config-spec
proposal: 2026-08-17-hub-reserva-keyword-config
repos: [minion_hub]
tags: [logic, test]
type: fix
---

# S0 actuals + amendments — `2026-08-17-hub-reserva-keyword-config-spec`

The spec was authored from minion-meta, where `minion_hub/` is not checked out; its §1
requires the carried paths/symbols to be corrected in-repo rather than implemented against
silently. The spec file itself is not tracked in this repository, so the corrections live
here. Written while implementing **S2**; extended with the **S3 actuals** below when S3 landed
(2026-08-29).

### S0 actuals — the three call sites (recorded at S2 time; S1 shipped the extraction)

| Site                        | Polarity                                                                                                                              | Column                                 | Shape                                        | Also a display label?              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------------- | ---------------------------------- |
| `crm-finance.service.ts`    | **both** — `depositMatchSql` for `has_deposit`, `notDepositMatchSql` for `has_proc`; `rankCustomers.topProduct` **excludes** deposits | `ii.description` (`fin_invoice_items`) | raw `sql` templates spliced into shared CTEs | no                                 |
| `crm-similarity.service.ts` | **excludes** — `notDepositMatchSql` in a `filter (where …)` + `having bool_or(…)`                                                     | `ii.description`                       | raw `sql` template                           | no                                 |
| `crm-journey.service.ts`    | **both** — `depositMatchSql` for the deposit flag and the representative-line ordering, `notDepositMatchSql` for `has_proc`           | `ii.description` / `ii2.description`   | raw `sql` template                           | **yes** — see the label note below |

A **fourth** consumer exists that the spec's three-site inventory did not name:
`crm-contacts.service.ts:runRankQuery` splices `crm-finance.service.ts`'s exported
classification CTE to compute the funnel floor. S2 therefore threads the rule through four
services, not three; `CONTACT_INVOICE_CLASS` (a module-level constant, i.e. one vocabulary
for every tenant) became `contactInvoiceClass(rule)`, so a caller physically cannot splice
it without deciding whose vocabulary it uses.

### Amendment 1 — the journey's deposit caption is `'Reserved a consult'`, not `'Reserva'`

§S2 assumed the journey site _renders_ the matched Spanish word and so specified
`label?: string  // default 'Reserva'`. It does not: the milestone caption for a
deposits-only invoice was the hardcoded English string `'Reserved a consult'`.

`DEFAULT_DEPOSIT_RULE.label` is therefore `'Reserved a consult'` — the default must be
whatever the code renders today, or every existing org's journey silently changes caption,
violating S2's own "leaves every existing org bit-identical" clause. `rule.label` now feeds
that caption, so the S2 DoD clause _"`label: 'Deposit'` → the journey milestone renders
'Deposit', not 'Reserva'"_ holds as _"renders 'Deposit', not `'Reserved a consult'`"_
(asserted in `crm-journey.service.test.ts`). Note the caption is not yet a Paraglide key —
pre-existing debt, unchanged by this spec.

### Amendment 2 — the `reserva` grep needs a third exclusion

The DoD grep `rg -i 'reserva' src/server/ --glob '!*.test.ts' --glob '!crm-deposit-rule.ts'`
also hits `src/server/services/crm-deposit-rule.fixtures.ts`, the classification fixture
table S1 created so `crm-deposit-rule.test.ts` and `crm-deposit-rule.sql.integration.test.ts`
assert the same inputs. It is test data, not production code; the grep needs
`--glob '!crm-deposit-rule.fixtures.ts'` as well. With that exclusion the result is zero hits.
S2 additionally renamed the journey query's dead `only_reserva_flag` column alias to
`only_deposit_flag`, which was the only _production_ hit left.

### Amendment 3 — the settings reader was inside `crm-contacts.service.ts`

The `crm_settings` reader S2 was told to extend (`getCrmSettings`) lived in
`crm-contacts.service.ts`, which already imports `crm-finance.service.ts`. Having finance
import it back would have created a cycle, so the query moved to the new
`src/server/services/crm-settings.service.ts` (the path §3 anticipated) as
`readCrmSettingsValue`; `getCrmSettings` now delegates to it. There is still exactly ONE
query onto `crm_settings.value` for the harvest scope and the deposit rule.
`crm-similarity.service.ts`'s pre-existing `winAnalysis` read/write is a different key with
its own error handling and was left untouched (out of scope: "do not opportunistically
widen the diff").

### Open item carried into S3 — CLOSED by the S3 section below

`depositWriteSchema` (strict write boundary) is defined and unit-tested in
`crm-deposit-rule.ts` but is not yet wired to an HTTP handler — S3 owns the
`/api/crm/settings` write path, the key-level jsonb merge, and the ⚠️ A3 `staleDerived`
disclosure. The in-code marker is `TODO(handoff):` at that schema. **The matching
proposal append (`proposals/2026-08-17-hub-reserva-keyword-config.md`) could not be made
from this run: minion-meta is not checked out in this environment.** ⚠️ A3 is CONFIRMED and
still applies — `crm-similarity.service.ts:buildWinIndex` does materialize `bought`/`snippet`
into `crm_win_embeddings`, so a keyword change leaves stored rows stale until a rebuild.

### Amendment 4 — merge with master's sibling settings service (PRs #143/#145)

Master landed its own `crm-settings.service.ts` and its own `resolveDepositRule` wiring for
`crm-finance.service.ts` / `crm-contacts.service.ts` while this branch was open. Master's
versions of those three files are canonical; this branch's S2 was re-applied on top of them
rather than replacing them:

- **Normalization has ONE home: `crm-settings.service.ts`.** Master's `normalizeDepositRule`
  (total — malformed input warns and returns `DEFAULT_DEPOSIT_RULE` instead of `null`) is the
  one kept. This branch's `normalizeDepositRule` + its lenient read schema were deleted from
  `crm-deposit-rule.ts`; that module now owns only the rule SHAPE, the caps, and the strict
  `depositWriteSchema`. The two caps are exported from `crm-deposit-rule.ts` and imported by
  the settings reader, so the read clamp and the write rejection cannot drift apart.
- **`crm-journey.service.ts` and `crm-similarity.service.ts`** — still module-default on
  master — carry this branch's per-org wiring, which is what S2 was for.
- **The journey's representative-item `ORDER BY` now uses `depositSortKeySql`** (master's
  helper), not the bare `depositMatchSql` predicate. A per-org rule may legitimately have
  ZERO keywords, and that predicate compiles to the literal `false`, which PostgreSQL rejects
  as a sort key (42601, "non-integer constant in ORDER BY"). Making that call site
  org-configurable without the CASE wrapper would have 500'd every contact journey for an org
  that configured `keywords: []`. Regression-guarded in `crm-journey.service.test.ts`.
- `DEFAULT_DEPOSIT_RULE.label` stays `'Reserved a consult'` (Amendment 1). Master's `'Reserva'`
  was never rendered anywhere — the journey hardcoded the English caption — so adopting it
  while feeding `rule.label` into that caption would have silently changed every existing
  org's milestone text.

---

## S3 actuals (2026-08-29) — write path, staleness disclosure, anti-recurrence guard

**Provenance / reconciliation.** S3 was first written on `orch/reserva-s3-pos-markers`
(hub PR #160), a draft PR that bundles this slice with the unrelated `pos-markers` spec and has
been `CONFLICTING` against master since 2026-08-28 (a separate repair run, PR #191, owns its POS
fixture blocker). None of it reached `master`, so S3 was genuinely unshipped. This branch lands the
**reserva-S3 half only** — the CRM settings write path, its tests, the RBAC mapping test and the
CI step — carried over unchanged where it was already correct, with the route-level rejection
coverage below added. The POS/stock half stays with PR #160.

### What shipped

| Piece                                                                                                                                                                        | Where                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `PUT /api/crm/settings` — strict `depositWriteSchema` parse, `updatedAt` never client-supplyable                                                                             | `src/routes/api/crm/settings/+server.ts`                                                              |
| `GET /api/crm/settings` — the org's resolved rule, gated on `crm:view` (GET is NOT covered by the central write hook)                                                        | same file                                                                                             |
| `writeDepositRule(ctx, patch)` — ONE `insert … on conflict do update set value = value \|\| jsonb_build_object('deposit', …)`; key-level merge, no select-then-update window | `src/server/services/crm-settings.service.ts`                                                         |
| ⚠️ A3 disclosure — `staleDerived` / `staleDerivedCount` in the response + a `warn` naming the org and row count                                                              | same function                                                                                         |
| Anti-recurrence guard — walks all of `src/server/`, fails on `/reserva/i` anywhere and on a raw `ilike '%…'` literal in any deposit-domain file                              | `src/server/services/crm-deposit-rule.test.ts`                                                        |
| Real-PostgreSQL merge proof (sibling `disabled_channels`/`accounts` survive, `updatedAt` stamped, `resolveDepositRule` agrees through an independent connection)             | `src/server/services/crm-settings.sql.integration.test.ts` + a CI step in `crm-deposit-rule-postgres` |

### DoD, clause by clause

- **Write gate** — `/api/crm/settings` is covered by the existing `/api/crm` entry in
  `API_WRITE_PREFIXES`, so no new registration; `apiWriteCapability('/api/crm/settings','PUT')
→ (crm, edit)` is now **pinned by a test** (`rbac.service.test.ts`) so a prefix refactor that
  stopped matching would fail loudly instead of silently ungating the write.
  Unauthenticated `/api/crm/*` never reaches the handler at all: `hooks.server.ts`'s `finishApp`
  401s any unauthenticated `/api/` path outside `API_UNAUTH_FALLBACK_PATHS`, which does not
  include `/api/crm`. The route also 401s on an unresolvable ctx (asserted).
- **Merge, never replace** — asserted twice: query-shape in `crm-settings.service.test.ts`, and
  actually executed against PostgreSQL in the integration suite (the shape assertion alone cannot
  prove PostgreSQL merges rather than replaces).
- **400s, row unchanged** — over-cap keyword, 21 keywords, unknown key inside `deposit`, a
  client-supplied `updatedAt`, an over-cap label, non-array `keywords`, a blank keyword, and a body
  with no `deposit` key: each asserted 400 **and** `writeDepositRule` never called
  (`src/routes/api/crm/settings/server.test.ts`). Extra _top-level_ settings keys are ignored, not
  rejected — this operation does not own the whole settings document.
- **Anti-recurrence guard verified red, then reverted** — done twice locally on this branch:
  adding `sql\`ii.description ilike '%reserva%'\``to`crm-journey.service.ts`fails the guard on
the keyword rule, and`'%adelanto%'` fails it on the raw-ILIKE-literal rule. Both reverted; the
  file is untouched in this diff.
- **`rg -i 'reserva' src/server/ --glob '!*.test.ts' --glob '!crm-deposit-rule.ts'
--glob '!crm-deposit-rule.fixtures.ts'` → zero hits** (Amendment 2's third exclusion still needed).

### Open items carried out of S3

- **Perf sanity NOT run** at the time this section was written — **now CLOSED**, and it moved the
  cap. See "Perf sanity — measured, and the cap came down to 5" below.
- **⚠️ A3 stays disclosure-only** — `crm_win_embeddings.bought`/`snippet` are not rebuilt on a
  keyword change; `TODO(handoff)` sits at the disclosure site in `writeDepositRule` and the matching
  proposal entry is on meta `dev`. Reclassifying history is the proposal's own out-of-scope. The
  disclosure itself was not _sound_ as first shipped — see "⚠️ A3 disclosure was racy" below.
- **No UI editor** — deliberate (spec §5): the keyword list is API-only until the `/crm/settings`
  ICP-definition editor exists. No `.svelte` file is touched by this slice.

---

## Ship-gate evidence completed after the S3 code landed (2026-08-29)

The S3 section above was written before two ship-gate clauses of §6 had actually been run.
They have now been run, and both had a finding.

### ⚠️ A2 sibling-repo grep — ONE real hit, in the gateway

Spec §6 step 3 (`rg -i 'reserva' ~/work/minion ~/work/paperclip-minion ~/work/packages`) is not
runnable as written here: this container checks out `minion_hub` alone, no sibling repo is on
disk. It was run against the same code remotely instead (GitHub code search over the org, then
the raw file for each candidate, on each repo's default branch):

| Repo                        | Result                                                                      |
| --------------------------- | --------------------------------------------------------------------------- |
| `minion-ai` (the gateway)   | **HIT** — `src/agents/tools/knowledge/crm-query-tool.ts:13` (branch `main`) |
| `paperclip-minion`          | zero hits                                                                   |
| `pixel-agents`              | zero hits                                                                   |
| `minion_plugins`            | zero literal hits (search stems matched `preservation` only)                |
| `minion-meta` (`packages/`) | zero hits — the §1 claim still holds                                        |

The gateway hit is the schema hint the CRM query tool ships to the model, verbatim:

> `fin_invoice_items(id, invoice_id, description, …) — description = product/service; reservation deposits ilike '%reserva%'.`

That is the fourth copy of the vocabulary the spec's ⚠️ A2 predicted, and it is the _worst_
shape of it: not a predicate but a prompt, so an org that configures `keywords: ['adelanto']`
now gets a hub that classifies on `adelanto` and an agent still being told to write
`ilike '%reserva%'` by hand. **Not fixed here, deliberately** — §4 ⚠️ A2 is explicit that a hit
belongs to `proposals/2026-08-17-gw-defaces-crm-tools` (approved, `repos: [minion]`, different
release train), and "two repos silently disagreeing about what a deposit is would be worse than
today's single wrong answer".

**The proposal append the spec asks for could NOT be made from this run** and is the one
outstanding item of this slice: the implementing harness is scoped to this repository and may not
push to, or open a PR against, `minion-meta`. Re-verified on 2026-08-29 during the review-fix
round (`gh api repos/NikolasP98/minion-meta/contents/proposals/2026-08-17-gw-defaces-crm-tools.md?ref=dev`,
read-only): the file's `## Open items` section still has no `crm-query-tool`, `reserva` or deposit
entry. Because the write side stays blocked, the hub-side half of the open-items ledger was
strengthened instead — a `TODO(handoff)` naming the exact gateway path/line, the owning proposal
and this document now sits on `DEFAULT_DEPOSIT_RULE` in `crm-deposit-rule.ts`, so the item is
greppable from the repo that caused it. The sentence to append, verbatim:

> `src/agents/tools/knowledge/crm-query-tool.ts:13` hardcodes the same single-tenant deposit
> vocabulary the hub just made org-configurable (`reservation deposits ilike '%reserva%'`, inside
> the schema hint handed to the model). Hub's `crm_settings.value.deposit` is now the source of
> truth for that rule (spec `2026-08-17-hub-reserva-keyword-config-spec`, S2/S3); this tool's
> description must be templated from the same org config, or the gateway will keep instructing
> agents to classify deposits by a word the org does not use.

### Perf sanity — measured, and the cap came down to 5

§6 step 5 has now been RUN, and it failed the spec's own threshold at 20 keywords.

**Method.** `scripts/deposit-keyword-perf.ts` (new, committed) builds the finance classification
query from the SHIPPED `depositMatchSql` / `notDepositMatchSql` builders — no hand-copied
predicate — and `explain (analyze, format json)`s it at several keyword counts, reporting the
median of 5 runs after a warm-up. `fin_invoice_items.description` is deliberately left unindexed,
which is the premise of the whole gate (§1 verified that in prod).

**Where it ran.** Still no PostgreSQL _server_ and no dev-DB credentials in this environment, so
the gate as literally written ("the largest dev org") remains unrunnable here. It was run instead
against a real PostgreSQL **engine** — `@electric-sql/pglite`, already used by this repo's CRM
suites for planner-faithful checks — over synthetic data at two sizes. What transfers is the
shape of the cost curve; what does not is absolute latency. pglite is single-threaded WASM with
no parallel workers and no real I/O, and the production query carries extra keyword-independent
cost (party joins, RLS, network), so **both** deviations make the ratios below an upper bound,
never an optimistic one.

| keywords | 120k items (median ms) | ×1-kw | 360k items (median ms) | ×1-kw |
| -------- | ---------------------- | ----- | ---------------------- | ----- |
| 1        | 452.2                  | 1.00× | 1442.7                 | 1.00× |
| 2        | 688.8                  | 1.52× | —                      | —     |
| 3        | 821.5                  | 1.82× | —                      | —     |
| 4        | 874.4                  | 1.93× | 2745.1                 | 1.90× |
| 5        | 965.4                  | 2.14× | 3021.5                 | 2.09× |
| 6        | 1139.6                 | 2.52× | —                      | —     |
| 8        | 1428.0                 | 3.16× | —                      | —     |
| 10       | 1833.7                 | 4.07× | —                      | —     |
| 15       | 2490.7                 | 5.53× | —                      | —     |
| 20       | 3171.4                 | 7.05× | 9332.4                 | 6.47× |

Cost is linear in keyword count and the ratios are scale-invariant across a 3× row count, which
is what an unindexed scan with N per-row `ILIKE`s predicts: the majority of lines are NOT
deposits, so the `and`-chain of `not ilike` has to evaluate every pattern before it can conclude.

**Decision — the spec's rule applied literally.** §3 S3 says: "If the 20-keyword case regresses
beyond ~2× on real row counts, lower the cap and say so here rather than shipping a configurable
foot-gun." 20 keywords regresses ~6.5–7×, so **`DEPOSIT_KEYWORDS_MAX` is now 5**, the largest size
still at the ~2× bound (2.09–2.14×; 6 is already 2.52×). Five keywords still hold a complete
deposit vocabulary — `reserva`, `adelanto`, `seña`, `anticipo`, `abono`. The `TODO(handoff)` that
sat on the constant is replaced by the measurement and a pointer to the script; raising the cap
again is an index question (a `pg_trgm` index on `description`), which is a schema change this
spec puts out of scope.

Reproduce: `bun run scripts/deposit-keyword-perf.ts` (the default explicitly runs 1, the current
cap, and the fixed 20-keyword ship-gate reference without duplicates; `DEPOSIT_PERF_ITEMS`,
`DEPOSIT_PERF_SIZES`, `DEPOSIT_PERF_RUNS` override those defaults). The approved largest-dev-org
measurement remains unexecuted because this environment has no dev-DB credentials; the recorded
PGlite evidence is synthetic PostgreSQL-engine evidence, not a substitute silently presented as
representative production data.

### ⚠️ A3 disclosure was racy — the win-index publication now serializes against the write

Found in review after S3 landed, and fixed here. `buildWinIndex` read the deposit rule, classified
every buyer, then left the database for its embedding round-trips before upserting
`bought`/`snippet` with `built_at = now()`. `writeDepositRule` stamped `updatedAt` from the
PROCESS clock before its transaction and defined stale rows as `built_at < updatedAt`. So a rule
change landing mid-rebuild produced rows derived from the OLD vocabulary carrying a timestamp
NEWER than the new rule — semantically stale rows that passed the timestamp test and were
reported as fresh. The disclosure the spec requires was, in exactly the window where it matters,
wrong.

Both halves are fixed:

- `lockDepositConfig` (new, in `crm-settings.service.ts`) — a per-org
  `pg_advisory_xact_lock(hashtext('crm-deposit-rule:' || org))`, the same namespace convention as
  `crm-analyze:` in `crm-conversation-analysis.service.ts`. `writeDepositRule` takes it first, and
  reads its `updatedAt` from `clock_timestamp()` (the DATABASE clock, and _after_ the lock — `now()`
  is transaction-start, which precedes the wait) so the stamp and `built_at` are comparable and
  ordered.
- `buildWinIndex` snapshots the rule's version (`resolveDepositRuleWithVersion`) and, under the
  same lock, rechecks it immediately before the upsert. A pass whose rule changed mid-flight is
  DISCARDED (`{ indexed: 0, skipped: 'rule-changed' }`) with a warn rather than published: the
  rows already in the table keep their older `built_at`, so they stay correctly counted as stale
  and the operator is still told to rebuild. Retrying instead would re-run the embedding spend
  under a rule that may change again.

Scope check while fixing it: `crm_win_embeddings` really is the only store of rule-derived data.
`crm-journey.service.ts` also classifies with the rule, but it persists ONLY the model's
`aiMilestones` into `custom_fields._journey` — the deposit-derived milestones in `base` are
recomputed from the live rule on every read, so there is no stale-classification store there and
nothing to serialize. The win-index POST's response shape is deliberately unchanged: a discarded
pass reports through the warn log and `buildWinIndex`'s return value, while the operator-facing
disclosure the spec asks for is the PUT's `staleDerived`/`staleDerivedCount`, which is what the
fix makes trustworthy.

Tests: `crm-similarity.service.test.ts` drives the exact interleaving (the mocked `embedTexts`
stands in for the concurrent PUT, flipping the stored version while the pass is embedding) through
the shipped publication path, and `crm-settings.service.test.ts` pins the lock-before-stamp order
and the DB-clock stamp. Both fail against the pre-fix code. `crm-settings.sql.integration.test.ts`
adds the real-PostgreSQL half (CI job `crm-deposit-rule-postgres`): a publication that commits
while the write waits on the lock must still be counted stale. That real-PostgreSQL suite was also
run locally against a genuine PostgreSQL server (a portable build installed outside the repo, not
a dependency change) before being pushed at CI: green with the fix, red in 345 ms without it —
this environment's lack of a database was the reason the previous round shipped a fixture bug to
CI, so the loop was closed here rather than there.

### Route-inventory baseline

S3 adds `src/routes/api/crm/settings/`, the first route this spec creates. That moves the
`src/routes` tree SHA that `tests/ui-audit/current-baseline.json` pins, so the baseline was
regenerated (`node scripts/ui-audit-inventory.mjs --clean-baseline`). Only the four provenance
fields move; the ledger is byte-identical and the summary still reads 140 screens / 10 redirects
— an API route is not a screen, so no route-contract count changed.
