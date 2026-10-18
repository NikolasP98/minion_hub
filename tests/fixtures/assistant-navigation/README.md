# Assistant navigation boundary

Build the actual MarkdownMessage, registered global tools and legacy runner:

```sh
MINION_NAVIGATION_FIXTURE_OUT=/owned/output bun tests/fixtures/assistant-navigation/build.mjs
```

Serve that output on loopback only. `window.navigationFixture` exposes `legacy()`,
`native()`, `revoke()` and the recorded `navigations`. Both execution methods must
leave the URL and navigation list unchanged; clicking the rendered Open link must
change both once. On a fresh mount, revoking access before clicking must block it.
Check the rendered reply at desktop and 390px widths, including keyboard activation.

The displayed price is synthetic fixture prose, not a model/database test. The
navigation transport records the actual component callback and changes local
history; this does not test a full SvelteKit route load or native independent fills.
