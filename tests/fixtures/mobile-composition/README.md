# Mobile composition fixture (plan 13-02, UI-04)

Production-bundles the **actual** Home (`src/routes/(app)/home/+page.svelte`) and
scheduling Calendar (`src/routes/(app)/scheduling/calendar/+page.svelte`) route
components with synthetic data, the (app) shell's height/scroll chain
(`Shell.svelte`) and `$app/*` / `$env/*` stubs.

No authentication, no server routes, no gateway socket, no credentials and no
production data. `seed.ts` holds six invented staff and twelve invented bookings
whose timestamps derive from a fixed day, so every measurement is deterministic.

From `minion_hub/`:

```sh
bunx svelte-kit sync                          # once — build.mjs needs .svelte-kit/tsconfig.json
MINION_MOBILE_FIXTURE_OUT=<some-writable-dir> node tests/fixtures/mobile-composition/build.mjs
python -m http.server 5197 --bind 127.0.0.1 --directory <some-writable-dir>
```

Then drive it from the owned Playwright specs:

```sh
E2E_MOBILE_FIXTURE_URL=http://127.0.0.1:5197 \
E2E_BASE_URL=http://127.0.0.1:5197 \
  bunx playwright test tests/e2e/ui-audit/home-mobile.spec.ts \
                       tests/e2e/ui-audit/calendar-mobile.spec.ts
```

`E2E_BASE_URL` is what makes `playwright.config.ts` skip its own `vite dev`
server. Without `E2E_MOBILE_FIXTURE_URL` both specs skip with an explicit
message rather than certifying an unmounted page.

`MINION_MOBILE_FIXTURE_OUT` overrides the build output directory; it defaults to
`<os tmpdir>/minion-mobile-composition-fixture`.

## What it does not establish

The authenticated app shell (sidebar, topbar, module nav), real gateway traffic,
real tenant data, other browser engines and assistive technology are out of
scope here — they belong to the seeded `route-audit` harness
(`tests/e2e/ui-audit/README.md`, `bun run audit:ui:seed`) and to plan 13-03.
`conn.connected` is set synthetically so the call/history controls render
enabled; no socket is opened.
