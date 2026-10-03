import { configDefaults, defineConfig } from 'vitest/config';
import base from './vitest.config';
import { nativePostgresFiles } from './scripts/qc/native-postgres-manifest';
import { qaTestDatabaseUrl, validateMarkedLoopbackPostgres } from './scripts/qc/loopback-postgres';

for (const marker of [
  'REQUIRE_CRM_CONTACTS_POSTGRES',
  'REQUIRE_CRM_FUNNEL_PARITY_POSTGRES',
  'REQUIRE_CRM_ACTIVITY_ROLLUP_POSTGRES',
] as const) {
  validateMarkedLoopbackPostgres(qaTestDatabaseUrl(process.env), process.env[marker], marker);
}

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: nativePostgresFiles('crm-pagination'),
    exclude: [...configDefaults.exclude],
    fileParallelism: false,
    maxWorkers: 1,
    retry: 2,
    passWithNoTests: false,
  },
});
