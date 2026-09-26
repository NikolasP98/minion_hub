import { defineConfig } from 'vitest/config';
import base from './vitest.config';
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['src/server/services/custom-properties.sql.integration.test.ts'],
    exclude: [],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
