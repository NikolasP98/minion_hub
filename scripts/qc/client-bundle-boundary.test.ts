import { describe, expect, it } from 'vitest';
import {
  assertClientBundleBoundary,
  clientArtifactBoundaryViolations,
  clientModuleBoundaryViolations,
} from './client-bundle-boundary.mjs';

describe('browser client/server bundle boundary', () => {
  it('accepts browser-safe fixture modules and ordinary public dependency text', () => {
    expect(
      assertClientBundleBoundary({
        label: 'safe fixture',
        modules: [
          '/repo/tests/fixtures/example/main.ts',
          '/repo/src/lib/components/Safe.svelte',
          '/repo/node_modules/@supabase/supabase-js/dist/module/index.js',
          '/repo/node_modules/svelte/src/server/index.js',
        ],
        artifacts: [{ path: 'entry.js', source: 'const postgresLabel = "display only";' }],
      }),
    ).toMatchObject({ violations: 0 });
  });

  it.each([
    '/repo/src/server/db/client.ts',
    '/repo/src/lib/server/posthog.ts',
    '/repo/src/routes/(app)/home/+page.server.ts',
    '/repo/src/lib/authority.server.ts',
    '$server/private.ts',
    '$app/server',
    '$env/dynamic/private',
    'node:fs',
    '/repo/node_modules/postgres/src/index.js',
    '/repo/scripts/qa/seed/index.ts',
    '/repo/src/lib/supabase-admin-client.ts',
  ])('rejects server-only module %s', (module) => {
    expect(clientModuleBoundaryViolations([module])).toHaveLength(1);
  });

  it.each([
    '$env/static/private',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TURSO_DB_AUTH_TOKEN',
    'MINION_QC_DATABASE_URL',
    'scripts/qa/seed/index.ts',
  ])('rejects emitted private marker %s', (source) => {
    expect(clientArtifactBoundaryViolations([{ path: 'entry.js', source }])).toHaveLength(1);
  });
});
