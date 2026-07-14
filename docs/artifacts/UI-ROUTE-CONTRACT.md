# Hub UI route and component contract

The executable UI contract lives in `src/lib/routes/`. It is the code-owned
bridge between SvelteKit routes, deterministic UI capture, responsive behavior,
the component library, and the future Figma archive. It does not replace Hub
RBAC; route metadata references the existing guards in `permissions.ts` and
`access/policy.ts` without changing their grants.

## Inventory invariants

- 142 filesystem page endpoints.
- 135 renderable screens: 125 app screens plus 10 public/auth/onboarding screens.
- Of those 10, five are truly unprotected (`/login`, forgot/reset, legacy invite,
  and public booking); join, link, and onboarding screens retain authentication.
- 7 redirect/proxy endpoints. Redirects have no screenshot or Figma frame.
- 28 dynamic fixture families.
- Every renderable screen has compact, medium, and wide capture viewports.

`route-design-manifest.ts` owns the archetype, scroll owner, responsive
transformation, access-policy reference, breadcrumb rule, applicable capture
states/personas, fixture, and Figma page/frame prefix for every endpoint.

The `immersive-workspaces` family maps to Figma page `50 Immersive workspaces`
and contains Home, Autonomous Agents, every Workshop screen, and Terminal.
Workforce also maps to page 50. Shell records remain in `40 Platform and
reliability`, matching the route ledger's platform/remote-work grouping.

## Capture is a two-stage contract

`resolveCaptureMatrix()` returns a capture **plan**. It deliberately does not
provision fixture data or install state-specific mocks. A plan entry named
`recoverable-error`, `forbidden`, or `empty` is only a label until a runner
prepares that state.

Before navigation and screenshot, runners must call
`prepareCapturePlanEntry()` (or an equivalent implementation) with the required
`prepareState(entry)` hook. The hook must install the state/persona-specific
database fixture, fake gateway response, network failure, or authorization
context. This prevents a runner from silently capturing the same default UI
under several state names. Call `resetCapturePlanEntry()` after the capture.

Public routes use route-specific state sets. `expired`, `not-found`, `complete`,
and `success` are present only where the screen can render those outcomes.
Record-detail routes similarly distinguish read-only, mutating, and destructive
confirmation contracts.

## Component registry

`component-design-registry.ts` assigns stable code IDs to shared primitives,
Hub foundations, overlays, shell components, and navigation. Shared component
variants reflect the generated `@minion-stack/ui` declarations, including:

- Button: five variants, six sizes, and default/icon shapes.
- Badge: status/semantic/neutral variants with separate status and semantic
  values.
- Card: numeric elevations 1-4, four padding values, and interactive state.

Each closed variant axis points to its source type union when one exists. The
validator reads the installed package declarations or local Svelte module type
and fails when metadata drifts from code. Figma component keys remain optional
until the reviewed Figma library exists; adding a key must not rename `codeId`.

## Validation

`src/lib/routes/route-design-contracts.test.ts` enforces:

1. Exact filesystem-to-manifest coverage and the 142/135/7/28 totals.
2. Unique IDs/patterns, dynamic parameter fixtures, access-policy references,
   viewports, states, personas, and family-to-Figma page mapping.
3. Redirect source status, target, path/query preservation, and alternates.
4. Static and templated primary/section/context navigation links resolving to
   a route contract (root `/` is the documented hooks-level redirect exception).
5. Component file/package exports and source union parity.
6. Capture-plan preparation and reset hooks.

Run the focused gate with:

```bash
bun run vitest run src/lib/routes/route-design-contracts.test.ts
```

Then run `bun run check`. Any new page must add its route metadata in the same
change; any new dynamic route must add or reuse a deterministic fixture; any new
nav destination must resolve through the manifest.

### Frontend link and API scanner

`src/server/ui-audit/frontend-contract-scanner.ts` adds a filesystem-backed
contract for identifiable frontend navigation and API calls. It resolves static
and templated `href`, route-object, and SvelteKit navigation destinations against
the page manifest. It also resolves `fetch`, `fetchJson`, and `jsonMutation`
calls against filesystem `+server` handlers and verifies the exported HTTP
method.

The current certified inventory is 142 page endpoints, 352 API handler files,
288 navigation references, and 389 method-specific frontend API calls, with no
unresolved destination or method mismatch. One Builder delete call deliberately
uses a typed runtime segment shared by the agents, skills, and tools handlers;
the test reason-codes those three compatible patterns and fails if the ambiguous
set grows silently.

Run the scanner gate with:

```bash
bun run vitest run src/server/ui-audit/frontend-contract-scanner.test.ts
```

This is a static contract, not a substitute for the authenticated browser
matrix. URLs assembled entirely through runtime variables, indirect request
wrappers, upstream gateway behavior, response schemas, authorization outcomes,
and third-party links still require behavioral or browser verification.
