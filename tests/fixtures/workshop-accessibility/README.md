# Workshop accessibility qualification

This fixture mounts the production agent controls, task dialog and pixel game loop.
Its agent inputs and submit callbacks are synthetic; the pixel OfficeState is real. It exercises no authentication,
server, gateway or customer data. It does not mount the full Workshop renderer.

Install the frozen Bun lockfile, run `bun run i18n:compile` and
`node node_modules/@sveltejs/kit/svelte-kit.js sync` in the checkout first. Choose
an existing private `TMPDIR` and an absolute, nonexistent
`MINION_WORKSHOP_FIXTURE_OUT`, then run:

```sh
node tests/fixtures/workshop-accessibility/build.mjs
python -m http.server 18907 --bind 127.0.0.1 --directory "$MINION_WORKSHOP_FIXTURE_OUT"
```

The build disables Vite configuration and environment loading. In another shell,
set `MINION_WORKSHOP_URL=http://127.0.0.1:18907`, private `PWTEST_CACHE_DIR`,
`TMPDIR`, `MINION_WORKSHOP_RESULTS` and `MINION_WORKSHOP_REPORT`, and select installed browser executables
with `PLAYWRIGHT_BROWSERS_PATH`. Run:

```sh
node node_modules/@playwright/test/cli.js test --config playwright.workshop.config.ts
```

`MINION_WEBKIT_EXECUTABLE` optionally selects an explicit WebKit executable.
Missing browsers fail. Eighteen cases cover Chromium, Firefox and WebKit: initial
and live motion preferences at the actual game-loop callback boundary, continued
state synchronization, resumption and disposal; actual OfficeState arrival/departure settlement and waiting-bubble expiry; keyboard agent selection and task
submission at 390/1280 pixels; native dialog focus, Escape, focus return and offline
submission controls. These are engine/component checks, not authenticated journeys.

TODO(handoff): Qualify Pixi/Habbo/Rapier motion, camera and relationship/element
keyboard alternatives through their actual consumers. See meta
proposals/2026-09-08-platform-qc-remediation.md (Workshop accessibility).
