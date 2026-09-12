import { defineConfig } from 'vitest/config';
import base from './vitest.config';
import { JOBS_POSTGRES_FILES, validateJobsPostgresLane } from './scripts/qc/jobs-postgres-contract';

// Pure admission checks before Vitest imports any SQL fixture or creates a client.
validateJobsPostgresLane(process.env, process.cwd());
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [...JOBS_POSTGRES_FILES],
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    passWithNoTests: false,
  },
});
