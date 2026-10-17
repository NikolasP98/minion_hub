# Deterministic UI capture and certification

The Playwright runner consumes `SCREEN_DESIGN_MANIFEST` directly. It expands the selected
routes through `resolveCaptureMatrix`, prepares every declared route/persona/viewport/state
entry through `prepareCapturePlanEntry`, and always runs the matching state and fixture reset
hooks. A state is never captured under a different label just because its fixture is missing.

The Hub root is client-rendered (`ssr = false`), so document or body visibility is not a capture
readiness signal. The runner waits for the authenticated `[data-part="app-viewport"]` shell (or
the shared public-task title for public/auth routes and redirect diagnosis), then verifies mounted
route content. A local Vite `504 Outdated Optimize Dep` response gets one bounded retry. Finally,
the encoded PNG must contain visual colour diversity; a solid canvas-colour image is a failed
capture, never evidence.

## Safe prerequisites

Provision a **disposable local** Supabase stack with all Hub migrations applied, then run:

```bash
bun run audit:ui:seed
set -a; source .env.ui-audit.local; set +a
bun run audit:ui:capture
```

The seed refuses non-local hosts and performs a relation-and-column preflight before it creates
or updates identities. If the local stack reports schema drift, reconcile the disposable stack;
never point the seed at a hosted/production project and never reset an existing user database.
`--reset` is reserved for a disposable audit stack and only recreates the four
`ui-audit-*@minion.test` identities.

Manifest state variants beyond deterministic read-only/default/access-policy states require a
local scenario provider. Set `E2E_UI_AUDIT_SCENARIO_ENDPOINT` to a loopback URL that accepts:

- `POST` with a `ResolvedCaptureRoute` to prepare a disposable DB/gateway state.
- `DELETE` with the same entry to reset it.

The runner refuses non-loopback scenario providers. Without the provider, loading, empty,
mutation, offline, unavailable, destructive-confirmation, and similar variants are emitted as
machine-readable `blocked-state` results. Missing auth/schema and fixture prerequisites become
`blocked-auth` or `blocked-fixture`; they are not unexplained login redirects or fake captures.
`E2E_UI_AUDIT_ALLOW_BLOCKED=1` is useful for reconnaissance, but it does not constitute final
certification.

## Matrix selection

Persona IDs match the route manifest:

```text
anonymous
owner-admin
manager-editor
member-viewer
restricted-no-module
```

The legacy owner/manager/member/restricted aliases remain accepted. `anonymous` clears cookies,
does not require credentials, and only resolves routes that explicitly declare that persona.
Select one, a comma-separated list, or `all`:

```bash
E2E_UI_AUDIT_PERSONA=anonymous E2E_UI_AUDIT_ROUTES=/login,/login/forgot bun run audit:ui:capture
E2E_UI_AUDIT_PERSONAS=owner-admin,restricted-no-module bun run audit:ui:capture
```

Every selected route executes all states declared for the selected persona and viewport class.
The exact viewport IDs are:

```text
compact-320       320x568
compact-360       360x800
compact-390       390x844
medium-portrait   768x1024
medium-landscape  1024x768
wide-1280         1280x800
wide-1440         1440x900
```

`compact`, `medium`, and `wide` remain aliases for 390x844, 768x1024, and 1440x900.

## Final certification modes

`bun run audit:ui:certify` adds these executable checks to every prepared scenario:

- keyboard-only Tab traversal of all visible tabbable controls;
- exact 200% reflow using half-sized effective CSS viewport dimensions;
- long-content/translation stress with restored text after measurement;
- one visible route title for standard page archetypes;
- behavioral reduced-motion activation with no running long/infinite animations.

Coarse-pointer CSS media behavior must be created when the browser context starts. Run the same
certification with touch enabled; interactive targets below the 44px contract then fail:

```bash
E2E_UI_AUDIT_POINTER=coarse bun run audit:ui:certify
```

Representative dark/light/CRT/Voxelized review remains bounded rather than multiplying all
routes by all themes:

```bash
representative='/home,/agents,/settings/appearance,/crm/[contactId],/agents/workshop/[id],/cloud/terminal'
for theme in dark light crt voxelized; do
  E2E_UI_AUDIT_THEME=$theme E2E_UI_AUDIT_ROUTES=$representative E2E_UI_AUDIT_VIEWPORT=compact-390 bun run audit:ui:certify
  E2E_UI_AUDIT_THEME=$theme E2E_UI_AUDIT_ROUTES=$representative E2E_UI_AUDIT_VIEWPORT=wide-1440 bun run audit:ui:certify
done
```

## Conformance rules (spec 014)

`E2E_UI_AUDIT_CONFORMANCE=1` records `result.conformance` on every rendered scenario, independent
of `E2E_UI_AUDIT_CERTIFY`: six rules (`overflow`, `targets`, `dominant-action`, `archetype`,
`health`, `title`), each with a verdict `pass | fail | allow-listed | blocked | n/a`, the measured
numbers and the offending element selectors. Rule definitions live in the meta-repo
`specs/014-page-conformance-harness/contracts/conformance.md`; evaluators in `conformance.ts`.

- `targets` is dense-aware: controls inside a `[data-dense]` subtree are excluded and the regions
  are listed (`dense`) by their nearest `data-component`/`data-part`; the floor stays 44 px coarse,
  24 px fine.
- `archetype` reads landmarks from the rendered DOM: `data-component` roots `data-table`,
  `filter-toolbar`, `collapsible-filters`, `editable-grid`, `detail-header`, plus the existing
  `page-shell`/`section-shell`/`page-header` parts. `DataView` is headless (its collection pages
  render a `data-table`); a `Sheet` is the Dialog root with `data-presentation="sheet"`.
- `overflow` reports `allow-listed` when `body` or the page shell declares
  `data-allow-document-overflow="true"`.
- `tests/ui-audit/conformance-allowlist.json` is the one hand-maintained allow-list (page, rule,
  class, reason, reverifiedAt). The static archetype test derives `KNOWN_NONCONFORMING` and
  `KNOWN_ARCHETYPE_DRIFT` from it; a failing rule with an entry reports `allow-listed` with the
  entry's reason.

```bash
E2E_UI_AUDIT_CONFORMANCE=1 E2E_UI_AUDIT_VIEWPORT=compact-390 E2E_UI_AUDIT_POINTER=coarse bun run audit:ui:capture
```

## Evidence

Outputs live under `test-results/ui-audit/`. The schema-v4 JSON run manifest is written
atomically after every scenario and attached to the Playwright result, so a later failure does
not erase earlier evidence. It records app commit, fixture version, namespace, exact viewport,
persona, route/state/scenario key, preparation method or blocker, screenshot, runtime/network
diagnostics, certification evidence, and captured/blocked/failed totals.

`tests/ui-audit/current-baseline.json` is the immutable pre-program endpoint ledger; regenerate
it only when the route surface intentionally changes.

## Conformance sweep

`bun run audit:ui:sweep` is the one mechanical page sweep (spec 014). It renders every manifest
app page as the audit personas and records, per page × viewport × pointer, a verdict for each
conformance rule (`overflow`, `targets`, `dominant-action`, `archetype`, `health`, `title` — see
the spec's `contracts/conformance.md`). Verdicts are `pass | fail | allow-listed | blocked | n/a`;
`blocked` and `n/a` carry a reason and never count as pass or fail.

```bash
bun run audit:ui:sweep                    # default matrix, compare against the committed ledger
bun run audit:ui:sweep --routes /stock/items,/agents
bun run audit:ui:sweep --full             # all personas × all viewports × both pointers (local only)
bun run audit:ui:sweep --update-ledger    # ratchet: rewrite the ledger when nothing regressed
bun run audit:ui:sweep --dry-run          # print the plan, touch nothing
E2E_BASE_URL=http://127.0.0.1:5199 bun run audit:ui:sweep --ci   # what CI runs
```

Steps, each printed with its outcome: (1) the QA stack is reachable on loopback
(`supabase status`), else `blocked: stack`; (2) `.env.qa` is written from the stack
(`scripts/qa/env.ts`); (3) `audit:ui:seed` provisions the four audit identities and the dynamic
fixtures and the sweep loads `E2E_UI_AUDIT_FIXTURES` from `.env.ui-audit.local`; (4) `vite dev`
is served on `127.0.0.1:5187` with `.env.qa` forced into the child env (or `E2E_BASE_URL` is used
as-is — the sweep then measures whatever backend that server talks to; only the seed is asserted
loopback); (5) one `route-audit.spec.ts` run per matrix entry with `E2E_UI_AUDIT_CONFORMANCE=1`;
(6) `scripts/ui-audit-conformance.mjs --compare --summary`. The seed and the server only ever see
a loopback `PUBLIC_SUPABASE_URL`; the sweep refuses anything else.

**Matrix.** Default (and `--ci`): `owner-admin` × `compact-390` coarse × `wide-1440` fine, state
`default`. `--full` widens to every persona, every viewport in `viewports.ts` and both pointers;
those extra rows are informational — only owner-admin/default rows enter the ledger. Run
artifacts are written to `test-results/ui-audit/run-sweep--<viewport>--<pointer>.json`
(schema v4, with screenshots, element lists and messages).

**Ledger.** `tests/ui-audit/conformance-ledger.json` is the committed ratchet baseline: sorted
keys, `pages[pattern]["<viewportId>:<pointer>"][rule] = { verdict, numbers… }`, no paths and no
timestamps, so two runs on the same code produce byte-identical files. `--compare` exits 1 on
any `pass|allow-listed → fail`, a `fail` whose numbers grew, a page whose ledger verdict is now
`blocked` (prerequisite regression — a fixture or login broke), a planned page without a ledger
row, a ledger row the run never reached, and an allow-listed row whose measurement now passes
("remove the allow-list entry"). Improvements print `ledger can be ratcheted`: exit 1 locally
until you run `--update-ledger` and commit the result, exit 0 in `--ci`. Without a ledger file
the compare prints `blocked: no ledger yet` and exits 0 — the first full run creates it with
`--update-ledger`.

**Allow-list.** `tests/ui-audit/conformance-allowlist.json` is the one hand-maintained list of
page × rule exemptions: `[{ "page", "rule", "class", "reason", "reverifiedAt" }]`. `class` is
`archetype-corrected` (the entry must disappear once the manifest archetype is fixed),
`owns-composition` (the surface legitimately composes its own landmarks) or `adoption-debt`
(kept with a follow-up pointer). The static archetype test derives its exemptions from this file;
reasons are mandatory and the compare demands removal once the measurement passes.

**Ratchet.** After a fix: `bun run audit:ui:sweep --update-ledger` (or
`bun run audit:ui:conformance -- --update-ledger test-results/ui-audit/run-sweep--*.json` on
existing artifacts), review the diff of `conformance-ledger.json` — only verdicts moving towards
`pass` or numbers shrinking — and commit it in the same PR. The script refuses to rewrite the
ledger when anything regressed.

**Summary.** `--summary` (always part of the sweep) renders `test-results/ui-audit/summary.md`
and `summary.html` from the ledger and the run artifacts only: run metadata, per-rule totals,
failing rows with the measured numbers and a screenshot link, allow-listed rows with class,
reason and re-verified date, blocked rows with their reason, and the compare result. Failing
pages' screenshots are copied to `test-results/ui-audit/failing/`.

**CI.** The `qa-stack` job installs Chromium after its smoke tests and runs
`bun run audit:ui:sweep --ci` against the dev server already up on `:5199`; the run artifacts,
summary and failing screenshots are uploaded as the `ui-audit-conformance` artifact
(`if: always()`). A regression fails the job on the compare step with the page and rule in the
log.

The ratchet matrix sets `E2E_UI_AUDIT_STATES=populated,default` so only the default populated
state of each page is measured (other declared states need the scenario provider and stay
informational under `--full`). Each Playwright invocation gets its own `--output
test-results/playwright-<run id>` directory: Playwright wipes its output directory on start, and
without this the second viewport's run would delete the first viewport's artifact.
