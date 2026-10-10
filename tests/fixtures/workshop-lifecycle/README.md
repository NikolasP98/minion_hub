# Workshop workspace lifecycle fixture (HC-037)

Bundles the real workspace list route (`(app)/agents/workshop/+page.svelte`),
the real `WorkshopToolbar` and `Toaster` on top of the real
`$lib/state/workshop/workshop.svelte` module, with a scripted `fetch`
transport (`window.__hc037`) instead of the API. No app server, no login, no
production data. The `$app`/`$env` stubs are the vitest ones; actor/org live
in `window.__hc037.page.data` so a test can rotate them mid-flight.

From `minion_hub/`:

```sh
node tests/fixtures/workshop-lifecycle/build.mjs   # → /tmp/minion-workshop-lifecycle-fixture
```

Serve the output on a loopback port and drive it with `browser-harness`
(evidence script: `evidence-hc037/drive.py` in the codex implementation dir).
Transport controls: `__hc037.calls[i].ok(body)` / `.fail(status)` / `.lose()`
settle the i-th captured request; `__hc037.auto[method + ' ' + url]` answers
a request immediately; `__hc037.gotos` records navigation; the state module
is exposed as `__hc037.ws`.
