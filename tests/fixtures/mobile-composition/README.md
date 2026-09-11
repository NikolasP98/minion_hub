# Mobile composition fixture (plan 13-02, UI-04)

Production-bundles the **actual** Home (`src/routes/(app)/home/+page.svelte`) and
scheduling Calendar (`src/routes/(app)/scheduling/calendar/+page.svelte`) route
components with synthetic data, the (app) shell's height/scroll chain
(`Shell.svelte`) and `$app/*` / `$env/*` stubs.

No authentication, no server routes, no gateway socket, no credentials and no
production data. `seed.ts` holds six invented staff and twelve invented bookings
whose timestamps derive from a fixed day, so every measurement is deterministic.

The owning project must already have its generated SvelteKit TypeScript config.
Do not load project environment files or start the normal app dev server to
prepare this fixture. With the installed Node binary and a fresh private output:

```sh
env -i PATH=/usr/bin:/bin HOME=<private-home> LANG=C.UTF-8 \
  MINION_MOBILE_FIXTURE_OUT=<fresh-private-output> \
  /usr/bin/node tests/fixtures/mobile-composition/build.mjs
```

The builder prints its exact output and private cache paths. Serve only that
output on an owned literal loopback listener. Supply its URL as
`E2E_MOBILE_FIXTURE_URL` to the isolated Playwright config; missing fixture
selection remains blocked evidence. The default output and cache folders are
unique directories under the system temporary directory.

## What it does not establish

The authenticated app shell (sidebar, topbar, module nav), real gateway traffic,
real tenant data, other browser engines and assistive technology are out of
scope here — they belong to the seeded `route-audit` harness
(`tests/e2e/ui-audit/README.md`, `bun run audit:ui:seed`) and to plan 13-03.
`conn.connected` is set synthetically so the call/history controls render
enabled; no socket is opened.

## Call controls and 44px targets (13-05)

`calls.html` mounts the real `CallControls` with local synthetic start, mute and
end callbacks. It never creates a voice session. The selected Home and call
specs deny external requests, WebSockets and microphone access. The call fixture
covers disabled state, keyboard language selection, accessible names, reduced
motion and the full active row at compact and desktop widths.

The builder now sets `envDir:false`; project `.env` files are not fixture inputs.
It creates a unique temporary cache and, unless explicitly given an output
folder, a unique temporary build folder. Its first JSON output records both.
Use an empty process environment and a fresh output directory. Do not invoke the
ordinary app dev server for these tests. Use the installed Node/Playwright
executables rather than downloading runners through `bunx`.

The 13-05 private runner/config and execution logs are recorded under
`/tmp/minion-13-05-repair-opc7sp2c`. It serves only the selected build directory
on an OS-assigned literal `127.0.0.1` port, runs only `home-mobile.spec.ts` and
`call-controls.spec.ts` with one headless worker, then closes its server. These
fixtures establish component/composition behavior; they do not establish real
voice/provider operation or authenticated product journeys.
