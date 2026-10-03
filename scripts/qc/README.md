# Local quality-control test lanes

Ordinary `bun run test` excludes native SQL fixtures before import. This protects
against importing legacy environment-selected database clients in the unit lane;
it is not evidence that the excluded behavior passes.

`scripts/qc/native-postgres-manifest.ts` is the admission authority. It assigns
every excluded file to exactly one of nine explicit lanes and records the full
required behavior names. The report validators reject missing files, missing
behaviors, failures and skipped cases. A passing assertion elsewhere in the same
file cannot replace a removed behavior.

| Lane              | Runtime                                                              | Configuration                                 |
| ----------------- | -------------------------------------------------------------------- | --------------------------------------------- |
| crm-deposit       | Dedicated loopback PostgreSQL                                        | `vitest.crm-deposit-postgres.config.ts`       |
| crm-pagination    | Dedicated loopback PostgreSQL                                        | `vitest.crm-pagination-postgres.config.ts`    |
| crm-concurrent    | Full-schema loopback QA database and seeded organization             | `vitest.crm-concurrent-postgres.config.ts`    |
| jobs              | Owned marked disposable PostgreSQL with vector extension available   | `vitest.jobs-postgres.config.ts`              |
| attachments       | Owned marked disposable PostgreSQL                                   | `vitest.attachments-postgres.config.ts`       |
| principal         | Owned marked disposable PostgreSQL                                   | `vitest.principal-postgres.config.ts`         |
| custom-properties | Full-schema loopback QA database                                     | `vitest.custom-properties-postgres.config.ts` |
| formula           | Full-schema loopback QA database                                     | `vitest.formula-postgres.config.ts`           |
| qa-native         | Full-schema loopback QA database plus owned marked pgvector database | `vitest.qa-native-postgres.config.ts`         |

Use `.github/workflows/ci.yml` for each lane's exact environment markers,
provisioning, command and result validator. Run with a fresh private output path;
retain the JSON receipt even when a lane fails. Never point these commands at an
application or production database. Only stop a fixture process/container whose
identity and ownership were recorded when provisioning it.

The marked disposable lanes require `MINION_QC_DISPOSABLE=1` and
`MINION_QC_DATABASE_URL`. The helper verifies the actual database owner
`minion_qc`, database comment `minion-360-disposable:v1` and loopback endpoint,
then creates a random isolated schema. Missing input, server or marker fails
qualification. The legacy `vitest.disposable.config.ts` remains the smaller
jobs/stock/effects selection; it does not replace all nine manifest lanes.

The jobs lane also owns `pos-categories.sql.integration.test.ts`. It applies the
complete category migration in an isolated schema, exercises its legacy backfill,
foreign-key actions and forced RLS, then verifies schema removal. The former
`pos-categories.pg.test.ts` entrypoint and its `HUB_TEST_DB_URL` fallback are removed;
missing disposable inputs now fail admission instead of silently skipping tests.

The `qa-native` lane now admits the formerly uncovered business persistence,
CRM journey, funnel rollup, tags and retention fixtures. Its configuration blocks
normal environment loading and requires the explicit loopback QA inputs. The
concurrent funnel fixture belongs to its separate `crm-concurrent` lane. Neither
is qualified merely because default unit discovery excludes it.

For safe discovery and admission checks:

```sh
bunx vitest run scripts/qc/jobs-postgres-contract.test.ts scripts/qc/native-postgres-manifest.test.ts scripts/qc/native-postgres-report.test.ts
```

Files-only discovery does not import selected test modules. Do not replace it with
collection that can initialize database clients, and never use
`--passWithNoTests` for qualification. Put a file filter before `--json` when using
Vitest discovery: the option accepts an output filename.
