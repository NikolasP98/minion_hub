# Slice 0 recon result: BLOCKED (stop-ship) — CRM funnel concurrency CI gate

**Spec:** `2026-08-20-handoff-minion-hub-3530856808-spec` — "Wire
`crm-funnel.concurrent.integration.test.ts` into a real CI gate".
**Stage:** dev, Slice 0 (recon) — opened blocked in run `0eb02565`, 2026-08-20; partially
answered by an operator-supplied live-prod extraction in run `12bb3918`, but still **BLOCKED**.
Slice 1 (the CI-only schema fixture) and Slice 2 (the CI job + `TODO(handoff)` marker removal)
are **not** implemented, deliberately.

## Why Slice 0 remains stop-ship

The spec requires four authoritative production inputs before Slice 1 may reproduce the CRM trust
boundary. The operator extraction supplied the policy rows, RLS flags, and required column shapes,
but omitted the `app_ledger` grants on `crm_contacts` and `crm_activities`.

The earlier Slice 1 attempt filled that gap with a locally selected "minimum" grant set and then
asserted the fixture catalog matched the same selection. That assertion was self-referential: it
proved only that the synthetic DDL matched itself, not that its privilege boundary matched
production. The fixture has therefore been removed. Service usage and sibling migrations are not
authoritative substitutes for the required production grant snapshot.

## Recon performed

The original run established that this repository and sandbox do not contain an authoritative
production schema snapshot:

| Access path to the authoritative catalog                                                        | Result                                                      |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `SUPABASE_DB_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `PUBLIC_SUPABASE_ANON_KEY` in the process env | unset                                                       |
| Same keys in `.env.example`                                                                     | present but blank                                           |
| `gh secret list --repo NikolasP98/minion_hub`                                                   | no Supabase credential                                      |
| `gh variable list --repo NikolasP98/minion_hub`                                                 | empty                                                       |
| Cached Vercel CLI auth / project link                                                           | absent                                                      |
| Local Supabase stack / `docker` / `psql` / `pg_dump`                                            | unavailable                                                 |
| `create table ... crm_contacts` / `crm_activities` in `supabase/migrations/`                    | zero hits — only self-seeding tests define throwaway copies |
| Checked-in `pg_policies` or grant dump for the CRM tables                                       | none                                                        |

The latest `VERDICT: FAIL` and all PR #153 comments were fetched on 2026-08-20. There is no
self-test failure comment. PR #154's operator task brief was also checked; it contains the same
partial extraction below and no grant rows.

## Partial authoritative extraction retained for the next run

The operator supervising the factory pipeline queried the live provisioned Supabase project on
2026-08-20. Operator memory records the method as `vercel env pull` followed by `psql` catalog
queries, with the temporary environment file deleted afterwards. PR #154's operator-authored task
brief records these results:

- `crm_contacts_org_guc` and `crm_activities_org_guc` are the only two policies; both are
  `PERMISSIVE`, `ALL`, `roles={public}`, with `qual` and `with_check` equal to
  `(org_id = current_setting('app.current_org_id'::text, true))`.
- `crm_contacts` and `crm_activities` both have RLS enabled and forced.
- `organizations` has RLS enabled and not forced.
- `crm_contacts.id` is `uuid NOT NULL default gen_random_uuid()`; `org_id` is `text NOT NULL`
  with no default.
- `crm_activities.id` is nullable `uuid default gen_random_uuid()`; `org_id` is `text NOT NULL`;
  `contact_id` is `uuid NOT NULL`.
- `organizations.id` is `uuid NOT NULL default gen_random_uuid()`.

These are authoritative facts, but they answer only three of the four required queries:

| Spec §3 Slice 0 query                                                              | Answered? |
| ---------------------------------------------------------------------------------- | --------- |
| `pg_policies` rows for `crm_contacts` and `crm_activities`                         | **Yes**   |
| `pg_class.relrowsecurity` / `relforcerowsecurity` for the required tables          | **Yes**   |
| `information_schema.columns` for `organizations.id` and the supplied CRM columns   | **Yes**   |
| `information_schema.role_table_grants` for grantee `app_ledger` on both CRM tables | **No**    |

## What unblocks Slice 1

An operator with access to the provisioned project must run the approved query and record its
complete ordered output and source:

```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_name in ('crm_contacts', 'crm_activities')
  and grantee = 'app_ledger'
order by table_name, privilege_type;
```

Only then may Slice 1 reproduce those literal rows in both its `GRANT` statements and its exact
catalog assertion. Until that output is available, no
`supabase/ci-fixtures/crm-funnel-concurrent.sql` should land.

## Rejected fixture experiment

The removed synthetic fixture was exercised successfully in PGlite, including exact policy
identity/cardinality checks, catalog mutations, and an org-A/org-B RLS negative control. That
evidence proved internal PostgreSQL behavior, but not production grant parity, so it cannot close
Slice 0 and is not shipped.

## Open end (ledger)

The existing `TODO(handoff)` at
`src/server/services/crm-funnel.concurrent.integration.test.ts:21` remains intentionally. Its open
end — the concurrency proof executes on no automated gate — cannot close until the grant snapshot
unblocks Slice 1 and Slice 2 lands a green CI job.
