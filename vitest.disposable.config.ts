import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';
import base from './vitest.config';
import { validateDisposableDatabaseUrl } from './scripts/qc/disposable-postgres';
import { nativePostgresFiles } from './scripts/qc/native-postgres-manifest';

validateDisposableDatabaseUrl(process.env.MINION_QC_DATABASE_URL, process.env.MINION_QC_DISPOSABLE);

// Exact reviewed fixtures only. Admission of a later fixture is a separate change.
// TODO(handoff): Add each new native job/driver fixture after its source and marker checks are reviewed; see meta proposals/2026-09-08-platform-qc-remediation.md (test-lane isolation).
const included = nativePostgresFiles('jobs').filter((file) =>
  /\/(?:job-effects|job-stock-concurrency)\.sql\.integration\.test\.ts$/.test(file),
);
for (const file of included) {
  if (!existsSync(fileURLToPath(new URL(file, import.meta.url)))) {
    throw new Error(`Missing admitted disposable test: ${file}`);
  }
}

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: included,
    exclude: [...configDefaults.exclude],
    passWithNoTests: false,
    maxWorkers: 1,
  },
});
