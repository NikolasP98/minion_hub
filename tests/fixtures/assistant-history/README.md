# Assistant history display fixture

Build actual Hub chat components with deterministic history messages and EN/ES localization:

```sh
MINION_HISTORY_FIXTURE_OUT=/fresh/owned/output node tests/fixtures/assistant-history/build.mjs
```

Serve the generated output on an owned loopback port and open `/?lang=en` or `/?lang=es` using browser-harness. Check all three history sections show a friendly localized notice, with no raw protocol marker. Check `window.historyFixture.storedMessageUnchanged()` is true and `navigations` is empty until the catalog link is clicked; after click it contains `/pos/catalog` once.

The real ChatTurn, ChatMessage, shared ChatBlocks, MarkdownMessage, source-link handler, display detector and localized messages are bundled. Gateway and voice calls, alias/tool-catalog network sources, access and navigation side effects are stubbed. No model turn or authenticated backend is used. The three displayed service names and prices are synthetic display data; SQL maximum/tie behavior is qualified by the PGlite service tests, not this fixture. Gateway transport budgets, authenticated browser authority and production are outside this fixture's proof.

Open `/?surface=floating&lang=en` or `/?surface=floating&lang=es` to mount the actual FloatingAssistant with tool-only history, a structured omission and a synthetic sourced answer. Verify the panel shows the friendly notice, one preserved tool call and the answer, with no raw marker. Verify source data stays unchanged and the source link navigates only after a click. This exercises the real folding step that the individual message sections omit.
