# Local quality-control test lanes

Ordinary `bun run test` uses `vitest.config.ts`. SQL integration modules are excluded before import, including legacy modules that select `SUPABASE_DB_URL` from the normal environment. This exclusion is not a native database qualification pass, and it does not certify every unrelated unit test as network-free.

Run native qualification explicitly from the Hub directory:

```sh
MINION_QC_DISPOSABLE=1 MINION_QC_DATABASE_URL=postgres://minion_qc@127.0.0.1:55439/minion_qc_jobs_stock node node_modules/vitest/vitest.mjs run --config vitest.disposable.config.ts
```

The selected server must be the owned disposable runtime, with database owner `minion_qc` and database comment `minion-360-disposable:v1`. The config validates explicit opt-in and URL shape. Each test's helper verifies the actual server/database identity before creating a random isolated schema in the marked database. Missing input, missing server or marker, and an empty test selection fail qualification.

The exact allowlist contains `src/server/services/job-stock-concurrency.sql.integration.test.ts` and `src/server/services/job-effects.sql.integration.test.ts`. Both received independent source/isolation review and actual marked-runtime qualification. Add later fixtures only after reviewing their source, environment isolation and marker enforcement; update discovery assertions with the admission. All native fixtures must use the `.sql.integration.test.ts` suffix. Neither a wildcard covering future work nor a default-unit skip counts as release evidence. The four existing legacy SQL fixtures are not admitted to this lane.

Safe collection regression:

```sh
node node_modules/vitest/vitest.mjs run scripts/qc/test-lanes.test.ts
```

This uses Vitest's files-only discovery, which does not import the selected test modules. Do not replace it with test collection that could initialize legacy live-database clients. Do not pass `--passWithNoTests` to qualification commands.

Runtime provisioning and cleanup are recorded in the meta-repo's `.planning/research/360-native-postgres-fixture.md`. Root owns the fixture process; stop only that identified process when all native work is finished.

### Quarantined mixed business persistence fixture

`src/server/services/brain-business-persistence.service.test.ts` loads normal application environment at module import and mixes four offline persistence cases with conditional live SQL EXPLAIN cases. It is explicitly excluded from default discovery before import and is not admitted to the disposable lane. This exclusion is not passing coverage: split the four offline cases and migrate the SQL cases to the marked fixture in an exact follow-up scope before re-admission. Do not execute it by relying on absent shell credentials; its loadEnv fallback reads application files.

`src/server/services/crm-funnel.concurrent.integration.test.ts` is also quarantined: it eagerly loads application credentials and selects an existing organization before its concurrent writes. Its full-schema PostgreSQL qualification is still required and must use an explicitly marked fixture. Neither excluded file is passing coverage. For filtered discovery put the file filter before `--json`; Vitest accepts an optional JSON output filename, so placing a test path immediately after that option writes to the test file.
