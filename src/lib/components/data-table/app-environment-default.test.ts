import { describe, expect, it } from 'vitest';
import { browser } from '$app/environment';

// Proves the suite-wide default from src/server/test-utils/env-stubs/app-environment.ts
// stays `false` for every file that does not opt in with its own
// vi.mock('$app/environment', ...) override (see DataTable.test.ts, which overrides
// browser: true only within its own file). This file imports the normal Vitest
// alias with no override, so a regression that flips the shared default would
// fail here rather than silently changing every other test's behavior.
describe('$app/environment default (no file-local override)', () => {
  it('is browser === false outside any opted-in test file', () => {
    expect(browser).toBe(false);
  });
});
