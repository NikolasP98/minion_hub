# Native Workshop motion qualification

The fixture creates actual classic/Habbo sprites, a Habbo element and Pixi WebGL
Application. Actual texture-cache code loads a local synthetic SVG. Only avatar
selection/configuration inputs are aliased; the native factories, renderers,
tickers, motion helper and Rapier physics module are unchanged imports.

Select an existing private `TMPDIR` and fresh absolute `MINION_MOTION_OUT`, then:

```sh
node tests/fixtures/workshop-motion/build.mjs
python -m http.server 18909 --bind 127.0.0.1 --directory "$MINION_MOTION_OUT"
```

The builder uses no application environment/config. Set
`MINION_MOTION_URL=http://127.0.0.1:18909`, private `PWTEST_CACHE_DIR`, `TMPDIR`,
`MINION_MOTION_RESULTS`, `MINION_MOTION_REPORT` and installed
`PLAYWRIGHT_BROWSERS_PATH` before running:

```sh
node node_modules/@playwright/test/cli.js test --config playwright.motion.config.ts
```

`MINION_WEBKIT_EXECUTABLE` can select a prepared runtime; report that choice.
Nine cases run in Chromium, Firefox and WebKit without skips or retries. They
observe real scale/alpha/hover geometry, visible reduced-motion reactions and
normal expiry, live preference changes, native sprite destruction and exact
preference-listener/ticker cleanup. Real Rapier step/impulse and explicit position
updates continue during reduced motion. Runtime versions accompany each test.
Requests outside the owned loopback origin fail. No provider/customer data is used.

The fixture runs an explicit physics callback; it does not mount the whole
Workshop/simulation scheduler or exercise authenticated task execution. An engine
receipt cannot certify all camera, relationship or element editing workflows.

TODO(handoff): Qualify full Workshop composition and remaining keyboard camera,
relationship and element editing operations. See
proposals/2026-09-08-platform-qc-remediation.md (Workshop accessibility). Shared
chart consumer/drilldown and real-provider authenticated acceptance are separate
remaining gates.
