import { configDefaults, defineConfig } from 'vitest/config';
import base from './vitest.config';
import { validateDisposableDatabaseUrl } from './scripts/qc/disposable-postgres';
import { qaTestDatabaseUrl, validateMarkedLoopbackPostgres } from './scripts/qc/loopback-postgres';
import { nativePostgresFiles } from './scripts/qc/native-postgres-manifest';

validateMarkedLoopbackPostgres(
  qaTestDatabaseUrl(process.env),
  process.env.REQUIRE_QA_NATIVE_POSTGRES,
  'REQUIRE_QA_NATIVE_POSTGRES',
);
validateDisposableDatabaseUrl(process.env.MINION_QC_DATABASE_URL, process.env.MINION_QC_DISPOSABLE);

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: nativePostgresFiles('qa-native'),
    exclude: [...configDefaults.exclude],
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 120_000,
    hookTimeout: 30_000,
    passWithNoTests: false,
  },
});
