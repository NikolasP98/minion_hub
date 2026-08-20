# Slice 0 recon result — CRM funnel concurrency CI gate

**Spec:** `2026-08-20-handoff-minion-hub-3530856808-spec` — "Wire
`crm-funnel.concurrent.integration.test.ts` into a real CI gate".
**Stage:** dev, Slice 0 (recon) — opened blocked in run `0eb02565`, 2026-08-20; **closed
UNBLOCKED in run `12bb3918`** on an operator-supplied live-prod extraction (see
"Slice 0 closed" below). Slice 1 (the CI-only schema fixture) is implemented in run
`12bb3918` at `supabase/ci-fixtures/crm-funnel-concurrent.sql`. Slice 2 (the CI job +
`TODO(handoff)` marker removal) is out of scope for this run and remains not implemented,
deliberately.

> The file name still says `slice0-blocked` because PR #154's task brief and the prior
> review both reference this exact path. The name is historical; the status is in the
> line above.

## Why this file exists instead of a fixture (original, run `0eb02565`)

The spec's Slice 0 is an explicit stop-ship gate (spec §3 Slice 0, §5 A1): the real RLS policy
text and column shape for `crm_contacts` / `crm_activities` must be read from the provisioned
Supabase project (or a verified schema clone) **before** the fixture is written, and

> If neither is available when this spec reaches dev, **stop and do not guess** — a hand-authored
> RLS policy that merely follows the `_org_guc` naming convention without independent confirmation
> would silently reintroduce exactly the failure class this proposal exists to close.

A fixture reconstructed from checked-in sibling migrations was committed earlier in that run
(`e809223`, `a2a790d`) and reverted. Reconstruction is not equivalence: if prod's real policies,
policy roles, grants, or `organizations.id` definition differ from the reconstruction, the new CI
job would go green while proving a security contract production does not have — a milder instance
of the very bug ("a test that is green because it never proved what it claims") this spec was
written to close.

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
checked-in production policy/grant definition for them.

To be precise about what _does_ exist — the `supabase/migrations/` row above is scoped to that
directory, not to the whole repository. `create table crm_contacts` / `crm_activities` statements
are present elsewhere, but only inside self-seeding tests that build their own throwaway schemas:
`crm-contacts.sql.integration.test.ts:76`, `crm-funnel-parity.sql.integration.test.ts:122`,
`crm-contacts.service.test.ts:33`, and `crm-journey.atomic-write.test.ts:172,187`. Those are
test-authored shapes, not evidence of what production enforces — which is exactly why they cannot
close Slice 0. **Nothing in this repository is used as a source for the fixture's shape.**

Also recorded, because it changes what "just supply the credential" would unblock: `docker`,
`psql` and `pg_dump` are **not installed** in this dev sandbox, so Slice 1's own machine-checkable
DoD (`docker run ... postgres:15` + `psql -f ...`) cannot be executed here. See "How the fixture
was verified" below for what was run instead.

## Slice 0 closed — the authoritative live-prod extraction

Path 1 of the spec's two unblock paths ("a human/ops operator with prod read access runs the
queries and pastes the results") **happened**, out of band, between runs. The operator supervising
the factory pipeline pulled the facts from the live provisioned Supabase project on 2026-08-20 and
handed them off.

**Method** — operator memory `/memory/MINION/sdlc-board-triage-and-phase-gates.md`, "TICK ~13:10Z"
entry, verbatim:

> **UNBLOCK PATTERN PROVEN: stop-ship → live prod extraction → requeue with verified facts**:
> pulled hub prod RLS via `vercel env pull` (minion-hub project) → psql pg_policies/
> information_schema (★pooler URL: user postgres.PROJECT, parse with urlsplit + PGPASSWORD;
> crm_contacts/activities org_guc policies, rls forced=true both, org_id TEXT not uuid) → dev run
> `485528fa` carries the verified DDL → deleted .env.prod after.

**Results** — the operator-authored task brief on
[PR #154](https://github.com/NikolasP98/minion_hub/pull/154) (`factory/485528fa-…`, the run that
brief was written for), quoted verbatim and in full:

> Slice 0 stop-ship is now UNBLOCKED with VERIFIED prod schema (extracted live from the
> provisioned Supabase project 2026-08-20 via pg_policies/information_schema — do NOT reconstruct
> from migrations): crm_contacts policy crm_contacts_org_guc ALL roles={public} USING (org_id =
> current_setting(chr(39)||"app.current_org_id"||chr(39)::text, true)) WITH CHECK same;
> crm_activities policy crm_activities_org_guc identical shape; BOTH tables rls=true AND
> forced=true (relforcerowsecurity); crm_contacts.id uuid NOT NULL default gen_random_uuid(),
> crm_contacts.org_id text NOT NULL no default; crm_activities.id uuid default gen_random_uuid(),
> org_id text NOT NULL, contact_id uuid NOT NULL; organizations.id uuid NOT NULL default
> gen_random_uuid(), rls=true forced=false. The exact policy text is: (org_id =
> current_setting(single-quote app.current_org_id single-quote::text, true)).

(The `chr(39)||…` / "single-quote" spellings are the operator's quoting workaround for embedding
`'` in the brief; both denote the same literal predicate
`(org_id = current_setting('app.current_org_id'::text, true))`, which the brief states outright in
its last sentence.)

This is the "equivalent authoritative source" spec §2 DELTA #1 allows: live `pg_policies` /
`pg_class` / `information_schema` output against the provisioned project, handed off by the human
who ran it. It is **not** a raw `psql` transcript — the operator recorded the extracted rows, not
the terminal capture, and deleted the pulled `.env.prod` afterwards. Everything the fixture asserts
is quoted above; nothing in the fixture is inferred from the `_org_guc` naming convention, from the
sibling `crm_conversation_chunks` migration, or from `pg-crm-schema.ts`.

### Slice 0 query coverage — what the extraction answers, and what it does not

The spec's Slice 0 names four queries. Three are answered; the fourth is not, and that gap is
carried explicitly rather than papered over.

| Spec §3 Slice 0 query                                                                                             | Answered? | Authoritative value, and where the fixture uses it                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `select … from pg_policies where tablename in ('crm_contacts','crm_activities')`                                  | **Yes**   | Exactly two policies: `crm_contacts_org_guc` and `crm_activities_org_guc`; `cmd = ALL`; `roles = {public}` (i.e. no `TO` clause); `qual` = `with_check` = `(org_id = current_setting('app.current_org_id'::text, true))`; PERMISSIVE. → fixture `create policy` blocks + assertion 2, which compares the full ordered row set and rejects any missing, extra, renamed or reshaped policy. |
| `select relname, relrowsecurity, relforcerowsecurity from pg_class …`                                             | **Yes**   | `crm_contacts` and `crm_activities`: both `true`/`true`. `organizations`: `true`/`false`. → fixture `enable`/`force row level security` statements + assertion 1.                                                                                                                                                                                                                         |
| `select column_name, … from information_schema.columns where table_name = 'organizations' and column_name = 'id'` | **Yes**   | `uuid`, NOT NULL, default `gen_random_uuid()`. → fixture `create table organizations` + assertions 3 and 4. The brief additionally supplies the `crm_contacts` / `crm_activities` id/org_id/contact_id definitions, which the same assertions cover.                                                                                                                                      |
| `select grantee, table_name, privilege_type from information_schema.role_table_grants … grantee = 'app_ledger'`   | **No**    | Not returned by the extraction. See the next section — the fixture makes no prod-parity claim about grants.                                                                                                                                                                                                                                                                               |

Nothing in the extraction references a helper function, table or role beyond the four fixture
objects the spec names (`organizations`, `crm_contacts`, `crm_activities`, `app_ledger`), so spec
§3's "inventory that dependency before S1" branch does not trigger.

### The one gap: `app_ledger` grants

The fourth query went unanswered, so the fixture **does not claim grant parity with prod**. It
grants the minimum this gate exercises and asserts exactly that set (assertion 5, exact match in
both directions, so a later edit that widens it fails the fixture):

| Grant                                                    | Why it is required                                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `select`, `update` on `crm_contacts`                     | `setFunnelStage`'s `SELECT … FOR UPDATE` (`crm-contacts.service.ts:1289-1294`) and `setContactCustomField`'s `UPDATE … RETURNING` (`:791-800`) |
| `insert` on `crm_activities`                             | `setFunnelStage`'s activity row (`crm-contacts.service.ts:1324-1337`)                                                                          |
| `insert` on `crm_contacts`, `select` on `crm_activities` | the cross-org negative control the spec mandates as `app_ledger` (§3 Slice 1 DoD)                                                              |
| `delete` on either table                                 | **not granted** — exercised by neither the suite nor the negative control                                                                      |

Why this cannot produce the failure mode Slice 0 exists to prevent: the risk is a fixture **more
permissive** than prod letting the gate certify a path prod would reject. A grant set that is
narrower than prod's cannot do that — a missing privilege raises `permission denied` and fails the
job loudly; it can never silently succeed. And prod necessarily grants at least these four, because
the shipped `setFunnelStage` path runs through exactly them in production today (PR #125, merged
2026-08-20). That is a deduction from running production code, not an inference from a naming
convention or from a sibling table's migration.

This is carried as a `TODO(handoff):` open end at the grant block in
`supabase/ci-fixtures/crm-funnel-concurrent.sql`, per the CLAUDE.md open-items ledger clause.
Resolving it means re-running the fourth query against prod and asserting its literal rows.

## How the fixture was verified (no docker/psql in this sandbox)

`@electric-sql/pglite` (already a hub devDependency) runs the fixture SQL through a real Postgres
engine in-process — the pattern established in operator memory factory note
`2026-08-20-0eb02565`. What was run:

1. **Clean apply** on a fresh database: succeeds, all five catalog assertions pass.
2. **Catalog readback**, confirming the applied schema equals the extraction:
   - `pg_policies` → exactly two rows, `crm_activities_org_guc` / `crm_contacts_org_guc`,
     `PERMISSIVE`, `{public}`, `ALL`, `qual` = `with_check` =
     `(org_id = current_setting('app.current_org_id'::text, true))`.
   - `pg_class` → `crm_activities` t/t, `crm_contacts` t/t, `organizations` t/f.
   - `information_schema.columns` → `crm_contacts.id` uuid NOT NULL `gen_random_uuid()`;
     `crm_contacts.org_id` text NOT NULL no default; `crm_activities.id` uuid **nullable**
     `gen_random_uuid()`; `crm_activities.org_id` text NOT NULL; `crm_activities.contact_id` uuid
     NOT NULL; `organizations.id` uuid NOT NULL `gen_random_uuid()`.
   - `role_table_grants` for `app_ledger` → exactly the six rows in the table above.
3. **Cross-org negative control** (spec §3 Slice 1 DoD), in one explicit transaction because
   `set_config(…, true)` is transaction-local: `set local role app_ledger`, GUC = org A, insert a
   contact + activity, assert both ARE visible under org A, switch the GUC to org B, assert both
   are now invisible. Passes.
4. **Mutation matrix** — each broken variant must RAISE rather than apply. All eight do:
   renamed policy; an extra duplicate policy; `force row level security` dropped from
   `crm_contacts`; `enable row level security` dropped from `organizations`; `crm_activities.id`
   "improved" to a primary key (i.e. NOT NULL); the grant widened with `delete`; the policy
   predicate weakened to `using (true)`; `organizations.id` made nullable.

Test 4 is the point of the assertions: they are a drift detector, not decoration. Note test 4's
fifth case — declaring `crm_activities.id` a primary key is a _stricter_ schema than the
extraction records, and the fixture rejects it, because proving the suite against a constraint prod
does not have is the same class of false certification as proving it against a weaker policy.

`@electric-sql/pglite` reports as a newer major than CI's `postgres:15`, so this is a pre-flight,
not a substitute for the real CI run — which is Slice 2's evidence requirement, not this run's.

## Residual risk (spec §5 A2) — accepted, not hidden

The fixture is a point-in-time snapshot of a 2026-08-20 extraction. If prod's policy text, RLS
flags, or the `crm_contacts` / `crm_activities` / `organizations` column shape changes later, the
fixture silently diverges and the future CI job could pass while testing a shape prod no longer
has. No automated drift check is built here — spec §6 puts one explicitly out of scope as its own
proposal. The fixture's header comment says so, and says to re-verify against prod if the suite
starts failing for no code reason.

## Open ends (ledger)

1. `TODO(handoff)` at `supabase/ci-fixtures/crm-funnel-concurrent.sql` (grant block) — prod's real
   `app_ledger` grant set for the two CRM tables is unverified; see "The one gap" above.
2. `TODO(handoff)` at `src/server/services/crm-funnel.concurrent.integration.test.ts:21` —
   intentionally left in place. Its open end (the concurrency proof executes on no automated gate)
   is genuinely still open until Slice 2 lands the CI job, and spec §3 Slice 2 forbids removing the
   marker before that job has run green.
