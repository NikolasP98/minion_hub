# Critical component journeys

Private fixture foundation: actual Home/Calendar route components, SecretEditModal,
ImageLightbox, native Dialog, and the snapshot's installed gateway client/service.
Synthetic page identity, HTTP responses and WebSocket frames provide deterministic
test data. No application server, authentication, database or provider is involved.
Home becomes connected only through the actual gateway service's handshake path.

Build in this private snapshot with an empty environment, private HOME and cache,
Node heap at most 1536 MiB, one build process and a fresh MINION_CRITICAL_OUT beneath
../output. The builder disables Vite config/env loading, records actual authority
module hashes, and rejects output exceeding 50 MiB or 550 files. The first build
rejected 518 files under the original 500-file cap; its roughly 31 MiB output
included the actual Home syntax-highlighter's lazy modules. The measured cap was
raised to 550 to preserve their loading behavior. Start serve.mjs
only after inspection; it serves immutable manifest files on 127.0.0.1:18903.

Run installed Playwright with playwright.critical.config.ts, explicit
MINION_CRITICAL_URL=http://127.0.0.1:18903, matching MINION_CRITICAL_OUT,
private MINION_CRITICAL_RUN and the pinned browser cache path. It starts no app,
allows only manifest asset requests, rejects native sockets and runs one worker.
Missing engines, skipped cases, missing cases and browser/page errors fail evidence.
The selected project subset is recorded; Chromium-only execution is not full-engine
qualification and the mandatory-matrix reporter returns a failed runner status
for any subset. All five named projects and all six cases per project are required.
Firefox does not receive unsupported touch emulation.

Desktop projects use 1280×900; the Chromium/WebKit coarse-pointer projects use
390×844. WebKit may select MINION_WEBKIT_EXECUTABLE explicitly: this session's
qualified wrapper is /home/nikolas/.cache/minion-qc/webkit-runtime-2026-09-11/run-webkit.sh.
It supplies privately extracted runtime libraries; the stock host dependency
check failed, so this result must not be reported as stock WebKit qualification.
The shared private browser cache is
/home/nikolas/.cache/minion-qc/browsers-2026-09-11.

The initial browser invocations set private HOME/XDG_CACHE_HOME but omitted
PWTEST_CACHE_DIR, causing Playwright's default shared transform cache under
/tmp/playwright-transform-cache-1000 to receive fixture transforms. These
initial results are preserved with that isolation exception. Corrected runs
must set PWTEST_CACHE_DIR to this snapshot's cache/playwright and TMPDIR to its
cache/tmp before starting the Playwright CLI; setting these after importing
Playwright is too late. The executable test config rejects missing private paths.
Browser profile/temp files and test transforms are both private in that lane.

TODO(handoff): Qualify actual login/session and authenticated CRM routing using a
fresh marked auth/database substrate with canonical schema and synthetic identities;
fixture page data cannot prove these boundaries. Root tracks this in
proposals/2026-09-08-platform-qc-remediation.md and phase 13's authenticated-journey gate.
Native assistive-technology and production deployment claims remain outside this slice.

Snapshot source and dependencies are preserved. Calendar/overlay fixture sources are
reused unchanged. The default application Playwright configuration and existing mobile
specs are not modified. Six mandatory cases are repeated per selected browser/input
project; exact browser versions and artifact digests accompany the report.

The Home transport covers the actual startup paths in gateway.svelte.ts,
chat-rpc.ts, agent-notes.svelte.ts, aliases.svelte.ts, channel-sources.svelte.ts,
agent-skills.svelte.ts and tool-catalog.svelte.ts: connect, agents.list,
sessions.list, chat.history, health, system-presence, channels.status, cron.list,
myAgent.feedToday, skills.status, channels.plugins.list and tools.status.
HTTP fixtures cover the token POST, host timestamp update, server list, active
flows, aliases, notes and activity-bin reads. Empty lists deliberately represent
an empty account; chat.send records the actual request and supplies a held final
response plus matching history. Unknown methods and HTTP requests still fail.
The fixture does not open email, notes mutations, Omnichat conversations, config
editing or voice capture; those request paths are not silently approved.

The qualified invocation runs from /tmp/minion-13-03-nwojsyi9/hub after starting
the inspected manifest-only server with MINION_CRITICAL_OUT pointing to output/v5:

```sh
env -i PATH=/usr/bin:/bin LANG=C.UTF-8 \
  HOME=/tmp/minion-13-03-nwojsyi9/home \
  XDG_CACHE_HOME=/tmp/minion-13-03-nwojsyi9/cache \
  PWTEST_CACHE_DIR=/tmp/minion-13-03-nwojsyi9/cache/playwright \
  TMPDIR=/tmp/minion-13-03-nwojsyi9/cache/tmp \
  PLAYWRIGHT_BROWSERS_PATH=/home/nikolas/.cache/minion-qc/browsers-2026-09-11 \
  MINION_WEBKIT_EXECUTABLE=/home/nikolas/.cache/minion-qc/webkit-runtime-2026-09-11/run-webkit.sh \
  MINION_CRITICAL_URL=http://127.0.0.1:18903 \
  MINION_CRITICAL_OUT=/tmp/minion-13-03-nwojsyi9/output/v5 \
  MINION_CRITICAL_RUN=matrix-v5-final \
  node --max-old-space-size=1536 node_modules/@playwright/test/cli.js test \
  --config playwright.critical.config.ts
```

The actual installed versions are shared 0.9.0, Svelte 5.57.0, Vite 8.1.3 and
Playwright 1.61.1. The custom reporter retains native browser versions, viewport,
network-boundary and focus observations from passing tests; missing runtime or
network attachments prevent a passing report. Initial passing reports omitted
those attachment bodies, so their behavior results have narrower evidence.
No product source or installed dependency was changed to make these cases pass.

Final evidence is under ../evidence/matrix-v5-final: 30/30 cases passed with
30 runtime receipts, 30 network-boundary receipts, zero unexpected native
requests/errors, and five native focus-state receipts. Observed browser versions
are Chromium 149.0.7827.55, Firefox 151.0 and WebKit 26.5. The artifact contains
528 manifest-listed files (35,767,102 bytes) plus its manifest. The source
preservation check verified all 3,278 copied inputs unchanged.

The focused config/spec/reporter strict noEmit check passed after correcting
fixture Window types. Those type-only changes produce byte-identical JavaScript
to the final browser run; ../evidence/type-only-equivalence.json records that
comparison. The complete application/Svelte check and native replay of the
combined newer product candidate remain the orchestrator's integration boundary.

Completion controls subsequently tightened only the server and reporter. The
server derives its allowed physical output tree from its module location, so
relocating the private snapshot preserves confinement. A real server copied into
the orchestrator's integration snapshot served its synthetic manifest, rejected
unlisted/traversal paths and POST, and refused mutated or foreign artifacts before
listening (../evidence/server-controls.json). Eight synthetic reporter controls
cover a complete matrix, missing project/case/receipt/artifact, duplicate or skipped
case, and manifest mutation. The actual Playwright CLI also ran six passing
synthetic tests in one project and exited 1 because the mandatory matrix was
incomplete; those controls make no browser claims. The reporter returns the
supported asynchronous status override and verifies that the manifest identity
stays unchanged from run start to finish. Root owns the integrated 30-case replay
using these tightened output checks; the prior native behavior evidence remains.

The September11 root integration builder always compiles current source. The earlier
optional compilation-reuse path checked only selected authority hashes, which could
miss a changed transitive component; it has been removed. MINION_CRITICAL_REUSE now
fails explicitly. Historical artifacts and their original receipts are preserved.
