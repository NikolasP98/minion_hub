// Slice 1 of specs/2026-08-21-hub-datatable-server-mode-test-gap-spec.md: proves
// the suite-wide `$app/environment` default (src/server/test-utils/env-stubs/
// app-environment.ts, aliased in vitest.config.ts) stays `browser === false`
// when nothing overrides it. DataTable.test.ts only exercises the file-local
// `vi.mock('$app/environment', ...)` override (browser: true) — without this
// no-override case, changing the alias or the default stub to `true` would
// leave that file green while silently making Node-side tests execute
// browser-only branches.
import { describe, expect, test } from 'vitest';
import { browser } from '$app/environment';

describe('$app/environment default (no override)', () => {
  test('browser is false through the configured vitest alias', () => {
    expect(browser).toBe(false);
  });
});
