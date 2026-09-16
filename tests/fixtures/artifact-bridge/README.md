# Native artifact fixture

Run the builder with an explicitly admitted private `/tmp/minion-14-07-browser-*` directory. It uses installed Vite, the actual host bridge and the selected plugin package. The three builtin HTML files are copied byte for byte; `manifest.json` records their identities.

Serve only that output on the root-selected loopback port. Use the browser-harness session assigned by the orchestrator. `window.qc` loads an opaque sandboxed iframe, holds or settles synthetic context responses, sends a versioned/legacy hello, injects an unrelated sibling message and records real event origins and RPC counts. It never contacts an app, gateway, database or model.

The control page is test instrumentation, not an application UI preview. Child screenshots show the actual builtin HTML. Native BFCache needs an observed persisted pageshow after real navigation; dispatching a synthetic event cannot establish it. Product responsiveness, stored/generated artifacts, host component lifecycle and deployed behavior have separate gates in the root QC proposal.
