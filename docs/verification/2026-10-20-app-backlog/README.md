# Hub app backlog verification

Baseline: `d42a14a26bc34f81876defd8d3bf3fdf9ccb2001` (Hub master).
Implementation checkout: `~/.cache/codex-implementation/hub-app-backlog-2026-10-20/hub`.
The original Hub and meta checkouts were preserved.

The five source proposals are on minion-meta PR #849. The implementation spec
is `specs/2026-10-20-hub-app-backlog-spec.md` in the sibling isolated meta checkout.

## Implementation boundaries

Session view memory stores filters, selection, expansion, panel identifiers and
scroll positions, with 80-entry bounds. It is scoped to actor/organization and
never writes browser storage. Explicit query/fragment links and browser history
remain authoritative. Only the shell Sidebar/module selector resumes a module root to its
last route; ordinary links retain their literal destinations. Peeks reload their records through the normal permission-checked
preload path; late responses are fenced by route, owner and request generation.
Shared tables and CRM/POS/calendar/inbox pages use these primitives.

Reversible server-controlled edits use optimistic overlays or their existing
autosave/local-draft contracts. Overlays fence overlapping completions and
identity changes. The CI scanner follows control values, local callbacks and
aliases. Exact, capped policy entries document consequential access changes,
workspace selection, financial transitions and already immediate local drafts;
these are not a backlog of waiting reversible controls. Recipe metadata changes
show immediately; inventory posting still waits for its receipt. Shared async
tag fields show pending feedback, restore confirmed rejections and retain drafts
when acknowledgements are unknown. Their handlers return the save promise.

Tables and board cards share typed record action catalogs. Right-click and
Shift+F10 use the same callbacks and permission/disabled decisions as the
existing visible controls. Editable text keeps its native browser context menu.

File drop is session/owner scoped, preserves specialized local drop targets,
validates batches before dispatch, and asks for a destination before uploading.
Current-record registration reuses AttachmentButton, its existing validated
presigned transport and server RBAC. File inbox and assistant drafts use the
existing generic file transport (4 MB per file); the inbox stays accessible from
the shell Files button. Assistant drops stage references and never send chat.
Successfully acknowledged files leave the batch before the next file begins.

The Tauri shell loads the hosted HTTPS Hub and grants remote pages only four
window-control permissions at that exact origin. It has native menus, tray,
single-instance deep links and no bundled Node server. See `src-tauri/README.md`
for auth behavior and the pinned dependency compatibility boundary.

The worker caches only current content-addressed assets and the public offline
page. Application navigations use network requests with cache disabled; API,
route-data, version metadata and other resources bypass worker caching. The
fallback reconnects to the original address without caching private HTML.

## Evidence classes

Mounted tests execute production components with synthetic data. The browser
fixture bundles production table, context menu, optimistic toggle, titlebar and
drop chooser code; its records/transports are synthetic. It does not prove
production auth, live object storage, signed installers or a deployed release.
The executable worker harness evaluates the actual service-worker source across
two build identities. Release/production checks require the owner's merge gate.

## Browser observations

Headless Chromium at loopback, using Browser Harness and the committed fixture:

- 1280×900: typed `Alpha`, selected Alpha, left CRM for POS, and returned.
  Search remained `Alpha`; Alpha remained selected.
- Right-click Alpha: Rename was available and incremented the same action
  counter as the card's visible Rename button.
- A one-second simulated write showed `aria-checked=true` and
  `aria-busy=true` immediately. A rejected next write showed intent first,
  then restored its committed value.
- A synthetic browser File/DataTransfer drop opened Files with `sample.txt`;
  the destination callback had not run. Clicking the registered current-record
  destination delivered the filename and closed the chooser.
- At 390×844, search and selection remained, a second drop opened the chooser,
  and `document.documentElement.scrollWidth <= innerWidth`.

Screenshots: [retained table](screenshots/retained.png),
[pending edit](screenshots/pending.png), [context menu](screenshots/context.png),
[drop chooser](screenshots/drop.png) and [mobile chooser](screenshots/mobile-drop.png). The fixture uses the installed Minion design
system and actual production components. File drop is a browser-dispatched
File/DataTransfer event; it is not an OS file-manager integration test.

## Native shell

`cargo check --manifest-path src-tauri/Cargo.toml` passed.
`cargo test --manifest-path src-tauri/Cargo.toml --lib -j 2` passed (1 test),
including hostile deep-link authorities/userinfo/ports and a path that resembles
another host. This is compiled Rust evidence, not an installed-app login test.

The native APIs follow the official [window customization](https://v2.tauri.app/learn/window-customization/),
[tray](https://v2.tauri.app/learn/system-tray/) and
[deep-link](https://v2.tauri.app/plugin/deep-linking/) contracts.

## Review

Standards: author review checked owner retirement, out-of-order replies,
transport reuse, authorization boundaries, semantic tokens and native IPC.
The optimistic owner regression also derives the visible value in a mounted
Svelte component; reads must not mutate reactive maps during rendering.

Spec: author review checked all five proposal transitions. Module resumption
is opt-in to shell selectors so an ordinary deep link is never redirected.
Unknown upload acknowledgements are removed from the retry batch. The desktop
binary loads the hosted origin and bundles no application server. Independent
PR review remains a release gate.

## Remaining runtime qualification

Authenticated CRM/POS route loads and installed OS-webview provider sign-in
were not exercised in this lane. The matching meta proposals contain the
checks; `TODO(handoff)` comments at the app layout's `afterNavigate` registration
and the Rust navigation policy point to them. Installed native file-drop
delivery is included in that OS-webview qualification. The local Chromium session had
no authenticated Hub session. Signing/distribution and deployment remain
owner-controlled release operations. No original checkout, shared QA stack or
production backend was modified.

## Local results

- `bunx vitest run --maxWorkers=2 --retry=2`: 891 files passed, 5 skipped;
  7,803 tests passed, 263 skipped, zero failures. Explicit native-Postgres
  qualification is a separate CI lane.
- `bun run test:architecture-recon`: 3 passed.
- `bun run check`: zero errors and warnings.
- `bun run lint:optimistic`: passes, 19 exact reviewed control policies.
- `bun run lint:design`: passes with no increased governed debt.
- `bun run lint:tokens`: zero violations.
- Native `cargo check`, deep-link test and `cargo build --offline --locked -j 2`:
  pass; the Linux executable was built.

The final owner-render regression uses the shared Button primitive and passes
after the design-gate correction. Screenshots and `FIXTURE-SHA256.json` describe
the current browser fixture; all 215 imported source hashes matched at capture.
`SOURCE-SHA256.json` identifies the candidate delta, including the deleted Node
loading page. CI status and final production build receipts are linked from
[Hub PR #575](https://github.com/NikolasP98/minion_hub/pull/575).
The proposal/spec companion is [meta PR #850](https://github.com/NikolasP98/minion-meta/pull/850).

The full-suite receipt above precedes the final panel-restoration correction.
That correction adds six passing cases for rejected/missing/offline panels,
ordinary-link fallback, owner retirement and fresh authorized data (10 passing
peek-suite cases including existing mode tests). The combined targeted regression
run passed 14 tests. Restoration never navigates away from the module on a failed
preload; normal record links retain their fallback. The browser screenshots and
215-module provenance were regenerated after this correction and formatting.
The final CI/build status is recorded on PR #575.

The native builder disables Tauri's drag/drop interceptor so WebView2 delivers
HTML5 File/DataTransfer events to the shared chooser. The Linux binary was
rebuilt with `cargo build --offline --locked -j 2` after this change and the
locked Rust deep-link test passed again. No filesystem capability was added.

The control inventory was also run without a component-name allowlist: no
additional uncovered edits were found. The committed gate now applies to every
controlled component name. A red/green contract test proves that newly named
Picker/CustomSwitch/DatePicker controls cannot bypass it; all six scanner tests
and the full control inventory pass, with the same 19 reviewed policies.
