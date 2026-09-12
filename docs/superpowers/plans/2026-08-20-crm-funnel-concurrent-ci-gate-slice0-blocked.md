# Slice 0 recon result: BLOCKED (stop-ship) — CRM funnel concurrency CI gate

> **RESOLVED 2026-08-29 — this document is a historical record, not the current state; see
> "Execution evidence" near the foot for the current, accurate status.**
> The stop-ship below is lifted for all four Slice-0 facts. Three arrived on 2026-08-20 by a
> live catalog extraction from the provisioned Supabase project (`pg_policies` /
> `information_schema`): the RLS policy text, the `relrowsecurity`/`relforcerowsecurity`
> flags, and the key column definitions for `crm_contacts` / `crm_activities` /
> `organizations.id` — path 1 of "What unblocks Slice 1" below. The fourth,
> `app_ledger`'s table privileges, arrived on 2026-08-29 from a source this document did not
> originally list: the operator's recorded past-session observations, which hold the
> production grant statement, its application to the production project, and a later
> permission readback against that same database (see "A1" under "Execution evidence").
> Slices 1 and 2 are implemented: `supabase/ci-fixtures/crm-funnel-concurrent.sql` (the
> fixture, with every extracted value recorded in its header and asserted executably at apply
> time) and the `crm-funnel-concurrent-postgres` job in `.github/workflows/ci.yml`. Both
> `TODO(handoff):` markers this branch ever carried are now removed.
> Everything below is preserved as written, so the reasoning that produced the stop-ship
> stays auditable.

**Spec:** `2026-08-20-handoff-minion-hub-3530856808-spec` — "Wire
`crm-funnel.concurrent.integration.test.ts` into a real CI gate".
**Stage:** dev, Slice 0 (recon) — run `0eb02565`, 2026-08-20.
**Outcome (as of that run — superseded, see the banner above):** Slice 0 could not be closed. Slice 1 (the CI-only schema fixture) and Slice 2
(the CI job + `TODO(handoff)` marker removal) are **not** implemented, deliberately.

## Why this file exists instead of a fixture

The spec's Slice 0 is an explicit stop-ship gate (spec §3 Slice 0, §5 A1): the real RLS policy
text and column shape for `crm_contacts` / `crm_activities` must be read from the provisioned
Supabase project (or a verified schema clone) **before** the fixture is written, and

> If neither is available when this spec reaches dev, **stop and do not guess** — a hand-authored
> RLS policy that merely follows the `_org_guc` naming convention without independent confirmation
> would silently reintroduce exactly the failure class this proposal exists to close.

A fixture reconstructed from checked-in sibling migrations was committed earlier in this run
(`e809223`, `a2a790d`) and reverted here. Reconstruction is not equivalence: if prod's real
policies, policy roles, grants, or `organizations.id` definition differ from the reconstruction,
the new CI job would go green while proving a security contract production does not have — a
milder instance of the very bug ("a test that is green because it never proved what it claims")
this spec was written to close.

## Recon performed (2026-08-20, dev sandbox, branch base `origin/master` = `678ad05`)

The spec's own Slice 0 command list was run. `origin/master` has advanced from the spec's
`5e77bbe7a` to `678ad05`, but `git diff --name-only 5e77bbe7a origin/master --
src/server/services/crm-funnel.concurrent.integration.test.ts .github/workflows/ci.yml
src/server/db/pg-crm-schema.ts` is empty — every AS-IS fact the spec asserts about those three
files still holds at `678ad05`.

| Access path to the authoritative catalog                                                        | Result                                                                                        |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `SUPABASE_DB_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `PUBLIC_SUPABASE_ANON_KEY` in the process env | unset (empty)                                                                                 |
| Same keys in `.env.example`                                                                     | present but blank (`.env.example:132-141`)                                                    |
| `gh secret list --repo NikolasP98/minion_hub`                                                   | only `CLAUDE_CODE_OAUTH_TOKEN`, `FACTORY_HOOK_SECRET` — no Supabase credential                |
| `gh variable list --repo NikolasP98/minion_hub`                                                 | empty                                                                                         |
| Local Supabase stack / `docker` / `psql` / `pg_dump` in the sandbox                             | none installed                                                                                |
| `create table ... crm_contacts` / `crm_activities` in `supabase/migrations/` (61 files)         | zero hits — only self-seeding test files define those tables, for their own throwaway schemas |
| Any checked-in `pg_policies` dump for the CRM tables                                            | none                                                                                          |

This independently reproduces the AS-IS finding in spec §2 and the operator-memory finding
`hub-supabase-schema-not-reproducible`: for `organizations` and the CRM contact tables there is
**no authoritative production migration or schema snapshot** checked into the monorepo, and no
checked-in production policy/grant definition (RLS policies, grants) for them.

To be precise about what _does_ exist — the `supabase/migrations/` row above is scoped to that
directory, not to the whole repository. `create table crm_contacts` / `crm_activities` statements
are present elsewhere, but only inside self-seeding tests that build their own throwaway schemas:
`crm-contacts.sql.integration.test.ts:76`, `crm-funnel-parity.sql.integration.test.ts:122`,
`crm-contacts.service.test.ts:33`, and `crm-journey.atomic-write.test.ts:172,187`. Those are
reusable scaffolding for a future fixture, but they are test-authored shapes, not evidence of what
production enforces — which is exactly why they cannot close Slice 0.

## What unblocks Slice 1

Either of the two paths the spec already names — nothing else:

1. A human/ops operator with prod (or verified schema-clone, per the `hub-local-qa-stack-recipe`
   operator memory) read access runs the four queries in spec §3 Slice 0 and pastes the results
   into the PR:
   - `pg_policies` rows (name, permissive, roles, cmd, qual, with_check) for both CRM tables,
   - `pg_class.relrowsecurity` / `relforcerowsecurity` for both,
   - `information_schema.role_table_grants` for grantee `app_ledger`,
   - the `organizations.id` column definition.
2. A scoped, read-only credential provisioned for that recon step only (never committed,
   never logged) — a decision for whoever runs the dev stage, not for this spec.

**Added 2026-08-29 — a third path this list originally missed.** The spec's DELTA #1 accepts
"an equivalent authoritative source" alongside a live query, and one existed the whole time:
the operator's recorded past-session observations (`~/.claude-mem/claude-mem.db`, memory tier 2).
For a prod-only object with no checked-in migration, the session that _authored and applied_
that object is usually recorded there, verbatim enough to reproduce. Four rounds of this branch
declared the grants leg unobtainable after searching only the process env, `.env.example`,
`gh secret`/`variable`, and `supabase/migrations/` — never that database. Search it before
declaring any production schema fact unreachable from the sandbox.

With those in hand, Slice 1's fixture DDL and its exact catalog assertions must be written to
match them literally (policy name/count, `permissive`, exact role set, `cmd`, `qual`,
`with_check`, and `app_ledger`'s privilege set), rejecting any missing or extra policy or grant.

## Open end (ledger) — both markers CLOSED

~~The `TODO(handoff):` marker at
`src/server/services/crm-funnel.concurrent.integration.test.ts:21` is intentionally left in
place: its open end — the concurrency proof executes on no automated gate — is still open, and
removing the marker while it is open is precisely what Slice 2 forbids until the gate is green.~~
Closed 2026-08-20: the gate exists (`crm-funnel-concurrent-postgres`) and runs green.

~~A **new** `TODO(handoff):` marker sits at `supabase/ci-fixtures/crm-funnel-concurrent.sql`
(next to the `app_ledger` grant statements) for a different open end: production's
`role_table_grants` row set for the two CRM tables was never extracted.~~ Closed 2026-08-29:
the production grant contract was located and reproduced (see "A1" below), so the fixture now
grants and asserts production's recorded set rather than a locally-inferred minimum. Neither
marker remains; `rg 'TODO\(handoff\)'` over the three files this spec touches returns nothing.

One residual
risk is carried forward deliberately, per spec §5 A2 and §6: the fixture is a point-in-time
snapshot of the extracted prod shape, and nothing re-checks it against prod on a schedule. If
prod's CRM RLS, grants or column shape drifts, the fixture's own catalog assertions will keep
passing against the stale snapshot. A scheduled fixture-vs-prod drift detector is explicitly out
of scope for this spec and belongs in its own proposal; the risk is recorded in the fixture's
header comment so whoever debugs a mystery failure reads it first.

## Execution evidence (spec §7 ship gate)

Recorded here rather than only in a PR description, because a PR body is not something a
future debugger greps. The `crm-funnel-concurrent-postgres` job's durable artifact is
`crm-funnel-concurrent-report` (`test-results/crm-funnel-concurrent.json`), uploaded under
`if: always()` so it outlives raw-log expiry.

Verified green runs (informational secondary record — NOT a substitute for the PR-description
gate below), each superseded by the next as the head advanced: `33260135098` (head `c5e2480`),
`33260656975` (`51c09df`), `33261472176` (`b1f3830`), `33263216313` (`89ae1cc`), `33264309260`
(`46438ea`), `33266093259` (`72da98b`). Every artifact reports `numTotalTests: 3, numPassedTests: 3,
numFailedTests: 0, numPendingTests: 0`, naming all three cases:

- `an automatic writer waiting on the row lock observes a concurrent manual pin`
- `a _funnel write queued behind an open _journey transaction keeps BOTH keys`
- `a _funnel write that commits INSIDE the _journey transaction is not reverted by it`

Zero pending is the load-bearing number, not zero failed: `describe.runIf(...)` makes "0 failed"
equally true when the suite never ran, which is the failure this whole spec exists to close.
Every later run re-uploads the same artifact name, so the check for any given commit is to read
that run's artifact rather than to trust a green tick.

No run above is guaranteed to be for the actual final reviewed head — every subsequent commit on
this branch invalidates the prior "final head" claim, and each of the five above was invalidated
that way in turn. Per spec §3 Slice 2 and §7, the Actions run URL and `crm-funnel-concurrent-report`
artifact name for the commit that is actually merged MUST be pasted into the PR description; this
doc is a durable secondary record for future debugging, not a replacement for that gate. Do not
treat a run number recorded here as satisfying §7 without first confirming it matches the commit
being merged.

**Who discharges that gate.** Not the dev-stage agent: its harness contract forbids pushing and
forbids opening or editing PRs, so it cannot write the PR body, and it cannot know the run id of a
workflow that only starts once the harness pushes the head it is currently authoring. The gate is
therefore a harness/human step. As of this round, the current head's own run has already finished,
so the block below is filled in and ready to paste into PR #201's description verbatim — no further
lookup needed unless the head advances again, in which case replace both values with the new head's
run (the per-commit checks permalink stays stable per-sha even after the branch advances):

```markdown
### Spec §7 ship-gate evidence (final head)

- Head: `72da98b83eb17876f3217882873eeead5a233eb4`
- Actions run: https://github.com/NikolasP98/minion_hub/actions/runs/33266093259
- Per-commit checks (stable): https://github.com/NikolasP98/minion_hub/commit/72da98b83eb17876f3217882873eeead5a233eb4/checks
- Job: `crm-funnel-concurrent-postgres`
- Durable artifact: `crm-funnel-concurrent-report` (`test-results/crm-funnel-concurrent.json`)
- Artifact must report: `numTotalTests: 3, numPassedTests: 3, numFailedTests: 0, numPendingTests: 0`
  — confirmed 2026-08-29 by downloading artifact id `9718688792` from this run: reports exactly
  `{numTotalTests: 3, numPassedTests: 3, numFailedTests: 0, numPendingTests: 0}`.

### Spec §3 Slice 0 source chain for the `app_ledger` grants (A1)

- Obs `21415` (2026-06-14T03:15:35Z) — migration `20260614031500_crm.sql` authored with
  `GRANT select/insert/update/delete to app_ledger` on all 5 CRM tables, plus enable+force RLS.
- Obs `21458` (2026-06-14T04:02:00Z) — that file applied to production project
  `gxvsaskbohavnurfvshr` under `ON_ERROR_STOP=1`, exit 0, post-verified 5 tables/2 views/5 policies.
- Obs `22073` (2026-06-16T02:41:51Z) — a permission readback against that production database
  confirming `app_ledger` holds full SELECT/INSERT/UPDATE/DELETE on the CRM tables.
```

**A1 (human gate) — RESOLVED 2026-08-29; all four Slice-0 facts are now attributed.**

_Legs 1-3 (policies, RLS flags, columns)._ The `pg_policies` policy text, the
`relrowsecurity`/`relforcerowsecurity` flags, and the column definitions spec §3 Slice 0 required
were supplied by the operator in the task description of PR #154 (run `485528fa`, merged
2026-08-28), taken live from the provisioned Supabase project on 2026-08-20, and are transcribed
verbatim into the fixture's header comment.

_Leg 4 (`app_ledger`'s table privileges)._ Not part of that payload, and four consecutive rounds
of this branch reported it unobtainable from the sandbox. That conclusion was wrong — not because
a credential appeared, but because the search space was too small. Every one of those rounds
checked the process env, `.env.example`, `gh secret list` / `gh variable list`, the absence of a
local Postgres, and `supabase/migrations/`. None searched the operator's recorded past-session
observations, the second of the three memory tiers the dev stage is explicitly pointed at
(`sqlite3 -readonly ~/.claude-mem/claude-mem.db`). That database holds the fact, in three
mutually corroborating production records:

| #   | Observation                                                                                    | Date                 | What it establishes                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `21415` "Complete CRM migration SQL created with security_invoker views and full RLS policies" | 2026-06-14T03:15:35Z | The hand-written companion migration `supabase/migrations/20260614031500_crm.sql` — the file `pg-crm-schema.ts`'s header names and that is not checked in — was authored with "Complete RLS setup: **GRANT select/insert/update/delete to app_ledger for all 5 tables**", "ENABLE + FORCE row level security on all 5 tables", and the five `*_org_guc` policies. |
| 2   | `21458` "CRM Database Migration Applied to Production Supabase"                                | 2026-06-14T04:02:00Z | That exact file applied to the production project `gxvsaskbohavnurfvshr` under `ON_ERROR_STOP=1`, exit code 0, post-verified as 5 `crm_*` tables, 2 views, 5 `crm_*` policies.                                                                                                                                                                                    |
| 3   | `22073` "Database permissions and data verified for FACES SCULPTORS organization"              | 2026-06-16T02:41:51Z | A permission **readback against that production database**: "app_ledger role has full SELECT/INSERT/UPDATE/DELETE privileges on all CRM tables including crm_contacts, crm_tags, crm_activities, …", recorded beside a live RLS behavioural check over real production data (1630 contacts for the FACES SCULPTORS org).                                          |

(1) is what was granted, (2) is that it reached production, (3) is a readback confirming it
there. Three properties make this the authoritative extraction the spec asked for rather than a
better-dressed guess:

1. **It is per-object, not a convention restated.** The same source records the canonical
   `messages` table as receiving `select/insert/update` only — three privileges, not four
   (obs `21413`). A house style would have given both tables the same set; these records
   distinguish them, so the four-privilege CRM result is a fact about `crm_contacts` /
   `crm_activities` specifically. This is exactly what the two reverted "by repo convention"
   revisions could not claim.
2. **It is independently cross-checked against the live catalog.** Record (1) also states the
   five `*_org_guc` policies and the enable+force flags it created. The 2026-08-20 live
   `pg_policies` extraction — obtained by a different person, from a different source, two
   months later — matches them exactly. The objects living in production today are therefore the
   objects that migration created, which is what carries its grant statement forward.
3. **The exact-set assertion is backed by the same record.** (1) captures the complete grant
   statement the migration issued, so `TRUNCATE` / `REFERENCES` / `TRIGGER` were never granted to
   `app_ledger` on these tables. The fixture asserts the set exactly — an extra privilege fails on
   apply, not only a missing one.

The fixture now grants `select, insert, update, delete` on both CRM tables and asserts exactly
`DELETE,INSERT,SELECT,UPDATE` for grantee `app_ledger` on each. The CI job's cross-org control was
moved back to inserting its two rows **as `app_ledger`** (spec §3 Slice 1's own DoD shape), which
also exercises the INSERT privilege and the policies' `WITH CHECK` arm — so the granted privileges
are proved usable, not merely present in the catalog.

_Honest limit._ Record (3) is a readback dated 2026-06-16, not a query run today; nothing re-reads
production's `role_table_grants` on a schedule. That is the same accepted A2 drift risk the
policy/column snapshot already carries (itself dated 2026-08-20), not a separate unverified leg.
Cross-checked against everything the repository can still say: no migration under
`supabase/migrations/` alters `app_ledger`'s privileges on either table — the only file
referencing them, `20260825100000_crm_contact_activity_rollup.sql` (2026-08-25, the newest
CRM-family migration), grants on its own new table and grants the same four — and no later
observation records a revoke.

Read the job accordingly: it proves RLS-policy parity, forced-RLS enforcement, grant parity with
production's recorded contract, cross-org isolation behaviour, and the atomic-write concurrency
claim, all against a point-in-time snapshot no scheduled job re-validates.

Verification of the change itself (no Postgres server in the sandbox): the fixture was applied
through `@electric-sql/pglite` (the hub devDependency already used by
`crm-journey.atomic-write.test.ts`) and mutation-tested. Clean apply and idempotent re-apply both
succeed and leave `app_ledger` holding exactly `DELETE,INSERT,SELECT,UPDATE` on both tables. Each
of these RAISEs on apply: an extra grant (`TRUNCATE`), a revoked grant (`DELETE`), all grants
revoked, grants moved to another role, `no force row level security`, a renamed policy, a policy
scoped `TO app_ledger`, a `primary key`/`not null` re-added to `crm_activities.id`, and a deleted
seed org row. The suite's own statement sequence (`SELECT … FOR UPDATE` → `UPDATE … RETURNING` →
`INSERT INTO crm_activities`) succeeds under `app_ledger` with these grants, and the workflow's
cross-org control passes on the real fixture while raising when the org policy is swapped for a
permissive one. PGlite reports as PG18 while CI runs `postgres:15`, so the authoritative run
remains the `crm-funnel-concurrent-postgres` job.

**A2 (schema drift) — accepted, not silently.** See the paragraph above and the fixture header.

## Review-fix round c8cb47f0 (2026-08-29) — blocker re-verified, not re-guessed

The cross-provider reviewer FAILed head `89ae1cc` on this exact A1 grants gap, asking for the
production `information_schema.role_table_grants` result to be obtained and reproduced literally.
That result does not exist anywhere this dev-stage agent can reach: re-checked this round —
process env, `.env.example`, `gh secret list`/`gh variable list` on `NikolasP98/minion_hub`, no
`psql`/`docker`/local Postgres, no Supabase MCP tool in the session — all empty/absent, identical
to the 2026-08-20 and 2026-08-27 findings above and to operator memory
`hub-local-qa-stack-recipe`/`factory/2026-08-20-c6b17283`. Also checked fresh this round: no
migration under `supabase/migrations/` ever grants privileges on `crm_contacts` or
`crm_activities` directly (the one file that references either, `20260825100000_crm_contact_activity_rollup.sql`,
only reads them inside a separate function and grants on its own new table) — so there is no
in-repo ground truth to fall back on either. Widening the grant set "by convention" was already
tried and reverted twice (see the table above and `factory/2026-08-19-cd344281`); repeating that
now would reproduce the exact guessing failure this spec exists to close. No fixture change was
made this round. This finding needs a human/ops operator to run spec §3 Slice 0's third query
against production and paste the result — it is not something a further automated review-fix
round can resolve.

## Review-fix round 7500d384 (2026-08-29) — the blocker was resolvable after all

The round above concluded that the A1 grants gap "is not something a further automated
review-fix round can resolve." That conclusion is now disproven, and the reason is worth keeping
because it is the reusable part of this whole branch: the search was exhaustive over the wrong
space. Rounds `485528fa`, `c8cb47f0` and their predecessors each re-checked live-credential paths
(process env, `.env.example`, `gh secret`/`variable`, local Postgres, MCP tooling) and the
repository's own `supabase/migrations/`, found nothing, and correctly refused to guess. None
searched the operator's recorded past-session observations — the second of the three memory tiers
the dev stage prompt names — where the production grant statement, its application to the
production project, and a later permission readback against that database had been sitting since
June (obs `21415`, `21458`, `22073`; see "A1" above).

For a prod-only object with no checked-in migration, that database is the _primary_ place to look,
not a fallback: the session that authored and applied the object is usually recorded there in
enough detail to reproduce it. Do not conclude "unobtainable from the sandbox" about a production
schema fact until it has been searched.

This round therefore: restored the fixture's grants to production's recorded contract
(`select, insert, update, delete` on both CRM tables) with the full provenance chain in the
fixture header; tightened the exact-set assertion to `DELETE,INSERT,SELECT,UPDATE`; moved the CI
cross-org control back to inserting as `app_ledger` (spec §3 Slice 1's own DoD shape, which now
also exercises the INSERT privilege and the `WITH CHECK` arm); removed the residual
`TODO(handoff)` marker; and re-verified the whole fixture plus nine drift mutations through
PGlite. No test logic, no production source file, and no migration was touched.

## Review-fix round 7500d384 round 2 (2026-08-29) — the last gap is a harness boundary, not a code defect

The reviewer's only remaining finding (Low) is that PR #201's description still carries only
factory task/manifest boilerplate, not the Spec §7 evidence block or the A1 source chain. Re-verified
this round against the current head rather than trusting the prior round's numbers:

- `gh pr view 201 --repo NikolasP98/minion_hub --json body` — confirmed the description is still the
  unedited factory boilerplate.
- `gh api repos/NikolasP98/minion_hub/actions/runs/33266093259` — confirmed `head_sha` is exactly
  the current branch tip `72da98b83eb17876f3217882873eeead5a233eb4` and `conclusion: success`.
- Downloaded artifact `crm-funnel-concurrent-report` (id `9718688792`) from that run directly and
  parsed the JSON: `numTotalTests: 3, numPassedTests: 3, numFailedTests: 0, numPendingTests: 0`.

All three checks passed, so the "Spec §7 ship-gate evidence" block above is now filled in with
concrete, confirmed values instead of `<sha>`/`<run-id>` placeholders, and the A1 source-chain
observations (21415, 21458, 22073) are repeated next to it in the same paste-ready block, since the
finding named both as missing from the PR body.

What this round did **not** do: run `gh pr edit` against PR #201. This session's harness contract
states plainly — "Do NOT push, do NOT open or edit PRs, do NOT touch git config — the harness
handles those" — and the PR body already carries a `factory-manifest` block the harness itself
manages; a dev/review-fix-stage agent overwriting that field is exactly the class of action the
contract exists to prevent. This is the same boundary the "Who discharges that gate" note above
already named before this round started, and it still holds: writing the PR description is a
harness/human step, not a dev-stage or review-fix-stage one. The reviewer's own top-line finding
score reflects this ("explicit ship-gate failure, not a runtime-code defect") — no fixture, CI, or
test-logic change was made or was warranted this round.
