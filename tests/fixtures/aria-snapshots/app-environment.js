// The shared stub (src/server/test-utils/env-stubs/app-environment.ts) says `browser = false`
// because Vitest runs under Node. This fixture runs in a real browser.
export const browser = true;
export const dev = false;
export const building = false;
export const version = 'aria-fixture';
