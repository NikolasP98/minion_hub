import { configDefaults, defineConfig } from 'vitest/config';
import base from './vitest.config';
import { qaTestDatabaseUrl, validateMarkedLoopbackPostgres } from './scripts/qc/loopback-postgres';
import { nativePostgresFiles } from './scripts/qc/native-postgres-manifest';

validateMarkedLoopbackPostgres(
  qaTestDatabaseUrl(process.env),
  process.env.REQUIRE_CUSTOM_PROPERTIES_POSTGRES,
  'REQUIRE_CUSTOM_PROPERTIES_POSTGRES',
);

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: nativePostgresFiles('custom-properties'),
    exclude: [...configDefaults.exclude],
    fileParallelism: false,
    maxWorkers: 1,
    passWithNoTests: false,
  },
});
