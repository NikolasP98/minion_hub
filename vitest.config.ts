import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/server/test-utils/setup.ts'],
    alias: {
      '$server': path.resolve('src/server'),
    },
  },
});
