# Slice 0 recon result: BLOCKED (stop-ship) — CRM funnel concurrency CI gate

**Spec:** `2026-08-20-handoff-minion-hub-3530856808-spec` — "Wire
`crm-funnel.concurrent.integration.test.ts` into a real CI gate".
**Stage:** dev, Slice 0 (recon) — run `0eb02565`, 2026-08-20.
**Outcome:** Slice 0 could not be closed. Slice 1 (the CI-only schema fixture) and Slice 2
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

With those in hand, Slice 1's fixture DDL and its exact catalog assertions must be written to
match them literally (policy name/count, `permissive`, exact role set, `cmd`, `qual`,
`with_check`), rejecting any missing or extra policy.

## Open end (ledger)

The `TODO(handoff):` marker at
`src/server/services/crm-funnel.concurrent.integration.test.ts:21` is intentionally left in
place: its open end — the concurrency proof executes on no automated gate — is still open, and
removing the marker while it is open is precisely what Slice 2 forbids until the gate is green.
