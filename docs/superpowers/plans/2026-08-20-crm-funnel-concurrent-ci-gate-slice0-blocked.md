# Slice 0 recon result: BLOCKED (stop-ship) — CRM funnel concurrency CI gate

> **STILL BLOCKED as of the review-fix round on run `55ba4b5f` (2026-08-23) — this document
> is the current state again, not just history.** An earlier pass of this run claimed the
> stop-ship was fully lifted and committed `supabase/ci-fixtures/crm-funnel-concurrent.sql`.
> That was only partly true. What the operator's live extraction (`sdlc-board-triage-and-
phase-gates.md`, "TICK ~13:10Z": `vercel env pull` for the minion-hub project, then `psql`
> against the pooler URL) actually covered was `pg_policies` (RLS policy text/roles/cmd/
> predicates), `pg_class.relrowsecurity`/`relforcerowsecurity`, and the key column
> definitions for `crm_contacts` / `crm_activities` / `organizations.id`. **It never covered
> `information_schema.role_table_grants` for grantee `app_ledger`** — the third bullet under
> "What unblocks Slice 1" below. The committed fixture's own header admitted this in plain
> text ("Grant SHAPE ... is NOT from the Slice-0 extraction ... follows this repo's uniform
> `*_org_guc` migration convention") and granted `SELECT, INSERT, UPDATE, DELETE` to
> `app_ledger` by convention anyway — exactly the "hand-authored ... without independent
> confirmation" guess spec §5 A1 says to stop rather than do. Cross-provider review caught
> it (a mutation adding `TRUNCATE`/`REFERENCES`/`TRIGGER` to the grant would have passed the
> fixture's own `has_table_privilege` check unchanged, since that check only asks for a
> minimum subset, not exact-set equality). This sandbox still has no Supabase credential, no
> Supabase MCP tool, and no docker/psql (reconfirmed 2026-08-23; see `gh secret list` output
> below, unchanged from the original recon) — so the missing extraction cannot be completed
> here. Per spec §5 A1's own instruction ("if neither is available ... stop and do not
> guess"), the fixture was **reverted** rather than shipped with a guessed grant set. The
> `pg_policies` / RLS-flag / column-shape facts already extracted remain valid and do not
> need re-extraction — only the `role_table_grants` query for `app_ledger` on
> `crm_contacts`/`crm_activities` is still outstanding. Slice 2 was never started in any pass
> of this run; the `TODO(handoff)` marker stays in place.

**Spec:** `2026-08-20-handoff-minion-hub-3530856808-spec` — "Wire
`crm-funnel.concurrent.integration.test.ts` into a real CI gate".
**Stage:** dev, Slice 0 (recon) — run `0eb02565`, 2026-08-20.
**Outcome (as of that run — superseded, see the banner above):** Slice 0 could not be closed.
Slice 1 (the CI-only schema fixture) and Slice 2 (the CI job + `TODO(handoff)` marker
removal) were **not** implemented at that time, deliberately.

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

**Update, review-fix round on run `55ba4b5f` (2026-08-23):** three of the four bullets above
ARE closed — reproduced here verbatim so the next Slice-1 attempt does not need to dig them
out of the reverted fixture's git history:

- `crm_contacts` policy `crm_contacts_org_guc` — `ALL`, roles `{public}`, USING/WITH CHECK
  `(org_id = current_setting('app.current_org_id'::text, true))`.
- `crm_activities` policy `crm_activities_org_guc` — identical shape.
- Both tables: `relrowsecurity=true` AND `relforcerowsecurity=true`.
- `crm_contacts.id` uuid NOT NULL default `gen_random_uuid()`; `crm_contacts.org_id` text NOT
  NULL, no default; `crm_activities.id` uuid default `gen_random_uuid()` (no NOT NULL —
  asymmetric with `crm_contacts.id`, verified as real, not a typo); `crm_activities.org_id`
  text NOT NULL; `crm_activities.contact_id` uuid NOT NULL; `organizations.id` uuid NOT NULL
  default `gen_random_uuid()`, `relrowsecurity=true`, `relforcerowsecurity=false`.

Only the fourth bullet — `information_schema.role_table_grants` for grantee `app_ledger` on
`crm_contacts`/`crm_activities` — is still outstanding; that query was never run against prod
in any pass of this spec. When it becomes available, Slice 1's fixture must grant exactly that
privilege set and assert exact-set equality (reject both missing and extra privileges) for the
direct `app_ledger` grants — not the
`has_table_privilege('select'|'insert'|'update'|'delete')` minimum-subset check the reverted
fixture used, which a mutation adding `TRUNCATE`/`REFERENCES`/`TRIGGER` would pass unchanged.

## Review-fix round 2 (run `55ba4b5f`, review `fb4d291f`, 2026-08-27)

Cross-provider review of the state left by round 1 (the banner and bullets above) returned
`VERDICT: PASS` with **no actionable findings**: it independently re-derived that Slice 0/A1
still blocks Slice 1 on the missing `information_schema.role_table_grants` extraction, that the
recon update correctly records what was and wasn't extracted, and that `.github/workflows/ci.yml`,
the concurrency test, and the `TODO(handoff)` marker are untouched (Slice 2 not started).

That PASS was voided for a process reason, not a content one: the reviewer edited the working
tree, which this factory's reviewers are contractually read-only for. Per the harness's own
protocol (round-3 audit hardening, 2026-08-17 — tree modifications by a reviewer are discarded
via `git checkout -- . && git clean -fd`, which forces the verdict to FAIL regardless of the
findings text, specifically so a fresh review runs against a clean commit), the edit was
discarded before this fix stage began. No stash, reflog entry, or dangling git object survived
it (checked `git stash list`, `git reflog`, `git fsck --unreachable --dangling` — all empty), so
what the reviewer attempted cannot be inspected or reproduced here.

**Disposition:** no code change was made in this round. The only diff versus the state round 1
left behind is this note, committed so the pipeline has a new SHA to run a fresh review against.
Slice 0 stays blocked on the same outstanding `app_ledger` grants extraction; Slice 1's fixture
stays reverted; Slice 2 stays untouched.

## Open end (ledger) — still open after review-fix round on run `55ba4b5f`

The `TODO(handoff):` marker at
`src/server/services/crm-funnel.concurrent.integration.test.ts:21` is intentionally left in
place: its open end — the concurrency proof executes on no automated gate — is still open, and
removing the marker while it is open is precisely what Slice 2 forbids until the gate is green.
Slice 1's fixture (`supabase/ci-fixtures/crm-funnel-concurrent.sql`) was committed once in this
run and then **reverted** in the review-fix round: cross-provider review found it granted
`SELECT, INSERT, UPDATE, DELETE` to `app_ledger` by migration-file convention rather than from
an authoritative extraction, which is precisely the guess spec §5 A1 forbids. Slice 1 remains
blocked — see the banner at the top of this file and "What unblocks Slice 1" above — pending a
`role_table_grants` extraction this sandbox cannot perform. Slice 2 (CI job wiring) was never
started in any pass of this run, per its own instructions ("implement ONLY Slice 0 and Slice
1... do NOT start later slices").
