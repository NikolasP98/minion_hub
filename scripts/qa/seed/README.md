# QA seed matrix

Deterministic, idempotent fixture data for the local QA stack (spec
`2026-09-16-hub-local-qa-stack-spec.md` §4/§6). Every row this seed writes is
registered against a stable string id in `matrix.ts`; the contract test
(`seed.contract.test.ts`) walks that matrix and asserts each id resolved to a
real row with the state the id promises.

## Adding a permutation

1. Add one entry to `MATRIX` in `matrix.ts`: `{ id, domain, why }`. Use the
   `domain.thing.variant` style already there — the `domain` field must match
   an existing module (`tenancy`, `crm`, `catalog`, `pos`, `scheduling`,
   `stock`, `finances`, `attachments`, `jobs`, `gateway`).
2. In the owning module (e.g. `pos.ts` for a `pos.*` id), insert the row.
   - Derive every id from the matrix id with `matrixUuid(matrixId[, salt])`
     (or `matrixTextId` for a text/cuid primary key) — never `crypto.randomUUID()`.
     A deterministic id is what makes a second `qa:seed` run a no-op instead
     of a duplicate insert.
   - Use `insert ... on conflict (...) do update set ...` (or `do nothing`
     for append-only/log tables) targeting the table's real unique
     constraint or primary key.
   - Call `register(matrixId, { table, where })` with a `where` that
     uniquely identifies the row you just wrote — this is what the contract
     test's generic existence check runs.
3. Usually, add one assertion. The generic `it.each` loop in
   `seed.contract.test.ts` already covers "the row exists" for every matrix
   id for free. Add a dedicated `it(...)` only when the permutation's whole
   point is a DERIVED state the generic check can't see (see
   `pos.grant.half-used`/`exhausted`, `stock.entry.issue-duplicate-invoice-id`,
   `tenancy.user.legacy-member`, `att.file.near-quota` for the pattern).
4. Run `bunx vitest run scripts/qa/seed/seed.contract.test.ts` against a
   bootstrapped QA database (`HUB_TEST_DB_URL` set) to confirm.

## Pairing rule (spec §6.1)

A PR that touches `supabase/migrations/*.sql` must also touch something under
`scripts/qa/seed/**` or `supabase/qa/baseline/**` — enforced in CI by
`scripts/qa/check-migration-seed-pairing.ts` (S4). If the migration genuinely
needs no new fixture (e.g. a pure performance index), say so in the PR body
and apply the `seed-unaffected` label instead of adding a no-op matrix entry.

## Absence contrasts

A few permutations in the spec are "X vs the _absence_ of X" (an org with no
`crm_settings` row, an org with zero `sched_event_kinds`, a contact with no
`crm_contact_activity_stats` row). These register with
`{ table, where, expect: 'absent' }` instead of the default `'present'` — see
`crm.settings.defaults-personal`, `sched.kind.none-personal` and
`crm.activity.stats-missing` for the pattern. The contract test's generic
`it.each` loop checks `ref.expect` and flips the assertion; there is no row to
insert for these ids, just the registration.

## Files

| File                    | Owns                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `ids.ts`                | UUIDv5 derivation, human ids, persona emails, the shared QA password                          |
| `db.ts`                 | `SeedContext`/`RowRef` types, the loopback guard, the seeded-table list, `countAllSeededRows` |
| `matrix.ts`             | The permutation registry                                                                      |
| `tenancy.ts`            | orgs, GoTrue users, memberships/roles, `app_modules`, `personal_agents`, join links/requests  |
| `crm.ts`                | parties, contacts, identities, tags, funnel/relationship/settings/activity                    |
| `catalog.ts`            | `fin_products` + `fin_product_components`                                                     |
| `stock.ts`              | warehouses, items, the entry chain + ledger/bins, accruals, consumption                       |
| `finances.ts`           | invoices, settings, personal-org statement imports, sync jobs, purchases                      |
| `scheduling.ts`         | resources/schedules/availability/event types/kinds/links/bookings + HR                        |
| `pos.ts`                | settings/series/shifts, tickets/lines/payments, grants/redemptions, plans, ledger, emissions  |
| `attachments.ts`        | `files`, `attachment_links`, `attachment_trash`, `attachment_file_state`                      |
| `jobs-brains.ts`        | `bg_jobs`, one succeeded `fin_sync_jobs` row, brains/knowledge pipeline                       |
| `gateway-libsql.ts`     | `tenants`/`servers`/`agents`/`sessions`/`session_tasks`/`chat_messages` (libsql)              |
| `ui-audit-compat.ts`    | keeps the 4 `ui-audit-*` personas working on the QA stack                                     |
| `env.ts`                | writes `.env.qa.local`                                                                        |
| `index.ts`              | orchestrator: preflight, module order, matrix coverage, `runSeed()`                           |
| `seed.contract.test.ts` | the contract test                                                                             |
