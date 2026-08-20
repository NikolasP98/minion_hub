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

## Evidence

Outputs live under `test-results/ui-audit/`. The schema-v3 JSON run manifest is written
atomically after every scenario and attached to the Playwright result, so a later failure does
not erase earlier evidence. It records app commit, fixture version, namespace, exact viewport,
persona, route/state/scenario key, preparation method or blocker, screenshot, runtime/network
diagnostics, certification evidence, and captured/blocked/failed totals.

`tests/ui-audit/current-baseline.json` is the immutable pre-program endpoint ledger; regenerate
it only when the route surface intentionally changes.
