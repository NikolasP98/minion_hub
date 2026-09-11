/**
 * Shared entry point for the two mobile-composition specs.
 *
 * They run against the isolated fixture built by
 * `tests/fixtures/mobile-composition/build.mjs`, which mounts the ACTUAL Home
 * and scheduling Calendar route components with synthetic data — no auth, no
 * server routes, no production data. Point both specs at a served build:
 *
 *   node tests/fixtures/mobile-composition/build.mjs
 *   python -m http.server 5197 --bind 127.0.0.1 --directory <build out>
 *   E2E_MOBILE_FIXTURE_URL=http://127.0.0.1:5197 \
 *   E2E_BASE_URL=http://127.0.0.1:5197 \
 *     bunx playwright test tests/e2e/ui-audit/home-mobile.spec.ts
 *
 * `E2E_BASE_URL` is what makes playwright.config.ts skip its own `vite dev`
 * web server. Without `E2E_MOBILE_FIXTURE_URL` the specs skip with this
 * message instead of certifying an unmounted page.
 */
export const MOBILE_FIXTURE_URL = process.env.E2E_MOBILE_FIXTURE_URL ?? '';

export const MOBILE_FIXTURE_HINT =
  'Set E2E_MOBILE_FIXTURE_URL (and E2E_BASE_URL) to a served build of tests/fixtures/mobile-composition. Missing fixture is blocked evidence, never a pass.';

/** The compact widths this slice qualifies, plus one desktop control. */
export const MOBILE_WIDTHS = [
  { id: 'compact-360', width: 360, height: 800 },
  { id: 'compact-390', width: 390, height: 844 },
  { id: 'medium-portrait', width: 768, height: 1024 },
] as const;

export const DESKTOP_CONTROL = { id: 'wide-1440', width: 1440, height: 900 } as const;

/** Contract floor for a pointer target on a compact viewport. */
export const MIN_TARGET_PX = 40;
