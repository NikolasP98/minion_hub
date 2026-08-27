---
id: 2026-08-17-hub-reserva-keyword-config-s0-actuals
title: 'S0 actuals + implementation amendments — CRM deposit-rule org config'
stage: spec
status: in-progress
created: 2026-08-20
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
here. Written while implementing **S2**; **S3 is not implemented yet**.

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

### Open item carried into S3

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
