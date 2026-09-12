import { defineConfig, configDefaults } from 'vitest/config';
import base from './vitest.config';
import { validateDisposableDatabaseUrl } from './scripts/qc/disposable-postgres';
import { PRINCIPAL_POSTGRES_FILES } from './scripts/qc/principal-postgres-contract';
validateDisposableDatabaseUrl(process.env.MINION_QC_DATABASE_URL, process.env.MINION_QC_DISPOSABLE);
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [...PRINCIPAL_POSTGRES_FILES],
    exclude: [...configDefaults.exclude],
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 30000,
    hookTimeout: 30000,
    passWithNoTests: false,
  },
});
