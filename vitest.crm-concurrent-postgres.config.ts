import { configDefaults, defineConfig } from 'vitest/config';
import base from './vitest.config';
import { nativePostgresFiles } from './scripts/qc/native-postgres-manifest';
import { qaTestDatabaseUrl, validateMarkedLoopbackPostgres } from './scripts/qc/loopback-postgres';

validateMarkedLoopbackPostgres(
  qaTestDatabaseUrl(process.env),
  process.env.REQUIRE_CRM_FUNNEL_CONCURRENT_POSTGRES,
  'REQUIRE_CRM_FUNNEL_CONCURRENT_POSTGRES',
);

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: nativePostgresFiles('crm-concurrent'),
    exclude: [...configDefaults.exclude],
    fileParallelism: false,
    maxWorkers: 1,
    retry: 2,
    passWithNoTests: false,
  },
});
