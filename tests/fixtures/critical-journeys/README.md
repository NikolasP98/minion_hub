# Critical component journeys

This isolated fixture mounts actual Home and Calendar route components,
SecretEditModal, ImageLightbox, native Dialog and the installed gateway service.
Synthetic identity, HTTP responses and WebSocket frames supply deterministic data.
No application server, authentication provider or database is involved. Home
connects through the actual gateway service handshake path to its fixture transport.

Install the frozen Bun lockfile, run `bun run i18n:compile` and
`node node_modules/@sveltejs/kit/svelte-kit.js sync`, and point
`PLAYWRIGHT_BROWSERS_PATH` at an absolute cache populated by the lockfile-selected Playwright
version. Then use the checked runner:

```sh
PLAYWRIGHT_BROWSERS_PATH=/absolute/browser-cache bun run test:critical-journeys
```

The runner creates fresh private build, evidence, HOME, temporary, and Playwright-cache paths,
stops only its owned loopback server, and preserves the full run root for review. The builder
disables Vite config/env loading, creates its own private cache,
records authority module hashes and refuses artifact reuse. It caps output at
50 MiB and 550 files. The server checks manifest digests before listening, rejects
symlink roots/files and serves only listed GET/HEAD assets at 127.0.0.1:18903.
An absolute output can live anywhere; no sibling checkout/cache layout is required.

The configuration starts no application server and uses one headless worker.
`MINION_WEBKIT_EXECUTABLE` can select a prepared WebKit runtime; record that choice
with results. Missing browsers fail. The reporter requires all six cases in all
five projects: Chromium/WebKit fine and coarse pointer, plus Firefox fine pointer.
A selected subset is not full qualification. Desktop is 1280×900; compact is
390×844. Missing cases, skipped cases, network/runtime receipts or mutated artifacts
prevent a passing matrix. Browser profiles/transforms use the supplied private paths.

Unknown HTTP/RPC calls fail. The transport covers actual service startup and a
held chat.send response with matching history. It does not approve email, notes
mutations, Omnichat, configuration editing or voice requests. Each fresh output and
runner evidence directory is the receipt for that source revision; historical
private paths and earlier matrix counts are not current qualification.

TODO(handoff): Qualify actual login/session and authenticated CRM routing using a
marked non-production provider/database with canonical schema and disposable
identities. Root tracks this in proposals/2026-09-08-platform-qc-remediation.md and
phase 13's authenticated-journey gate. Synthetic page data cannot prove server
identity, organization isolation or authorization. Native assistive technology,
full application builds and deployed behavior require separate acceptance evidence.
