import { defineConfig } from 'vitest/config';
import base from './vitest.config';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: [
      'src/server/services/formula-sql.sql.integration.test.ts',
      'src/server/services/formula-properties.sql.integration.test.ts',
    ],
    exclude: [],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
