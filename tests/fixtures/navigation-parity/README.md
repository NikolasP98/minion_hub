# Navigation parity fixture

This fixture mounts the real Hub Topbar, Sidebar, Sheet/Dialog, HostPill, ProfileMenu,
permission helpers, ordered sections, and plugin navigation. Synthetic admin,
restricted-business and personal personas come from `?persona=`. Their saved order
places Agents first and Workshop before Autonomous. Links retain their real target
and click handlers; a document listener prevents fixture navigation afterward.

The builder stubs the SvelteKit environment and side-effect services (notification
polling, finance refresh, authentication mutations). It does not authenticate,
contact a gateway, or exercise server authorization. The account dropdown and host
control remain actual components. All referenced application font files are copied
with SHA-256 identities in `fixture-manifest.json`.

Run the installed Node/Vite toolchain in an empty environment, with a disposable
HOME and output outside the checkout:

```sh
env -i PATH=/usr/bin:/bin HOME="$TASK_FIXTURE_HOME" TMPDIR="$TASK_FIXTURE_TMP" LANG=C.UTF-8 \
  MINION_NAV_FIXTURE_OUT="$TASK_FIXTURE_OUT" \
  node --max-old-space-size=1536 tests/fixtures/navigation-parity/build.mjs
```

Set those paths to private directories, with an output path that does not yet exist. Run native `i18n:compile` and `svelte-kit sync` first in a fresh checkout.

The build sets `configFile: false`, `envDir: false` and a unique private Vite cache.
It never loads this checkout's `.env`. Serve the artifact only on an owned
`127.0.0.1` ephemeral port and set `E2E_MOBILE_FIXTURE_URL` to that exact origin.
Use a private Playwright config selecting only `navigation-parity.spec.ts`, one
headless worker, private results and installed browser executables. Its shared
`mobile-fixture.ts` fixture rejects external requests, WebSockets and microphone
access. No application dev server or normal environment loader is needed.

The browser suite checks actual 360/390/768/1440 layouts, all permitted desktop
links and their order, denied utility omissions, Escape and outside dismissal,
background inertness, focus return, breakpoint closure, short-screen scrolling,
44px mobile targets, 600×390 landscape scrolling, reduced motion and real font geometry. The small native
Vitest suite separately checks the shared utility and empty-section policies.
These fixtures do not certify real login, organization switching, gateway
connectivity, logout, or every route in the application.
