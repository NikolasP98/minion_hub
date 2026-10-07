# role="button" keyboard contract fixture (HC-027)

Bundles the real `AgentGroupHeader`, `AgentDashboard`, `EmailCard`, `AgentCard` and
`PortalOverlay` with synthetic props, English messages and the vitest `$app`/`$env`
stubs, on top of the real `src/app.css` (so the global `:focus-visible` ring is the
production one). No app server, authentication or writes. `AgentSidebarHost.svelte`
and `AgentNodeHost.svelte` are mount hosts for the happy-dom twin only.

From `minion_hub/`:

```sh
MINION_ROLE_BUTTON_OUT=/path/out node tests/fixtures/role-button-keys/build.mjs
python3 -m http.server 8793 --bind 127.0.0.1 --directory /path/out
```

Drive it through browser-harness against the headless Chromium (CDP
`Input.dispatchKeyEvent`): real Tab to each control, Enter and Space each bump the
site's `window.__hc027` counter by exactly 1, `window.scrollY` is unchanged after
Space, `document.activeElement` has a non-`none` computed outline, and Enter on a
nested Button leaves the parent counter unchanged. The happy-dom twin is
`src/lib/a11y/role-button-keys.mounted.test.ts`.
