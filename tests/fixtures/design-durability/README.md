# Executable composition recipes

Build with `MINION_DURABILITY_FIXTURE_OUT=/tmp/minion-design-durability-render node tests/fixtures/design-durability/build.mjs`, then serve that directory on loopback. These fixtures use actual installed shared archives and Hub components, with synthetic data and local SvelteKit adapters. They do not certify authentication or production writes.

Open `recipes.html?recipe=collection&lang=es` (also board, gallery, detail, form, dashboard, workspace, controls), and `calendar.html` for the actual scheduling route. States: populated, loading, empty, validation-error, conflict, unknown, stale, committed-refresh-failed, local-only, error. Recipe status messages demonstrate placement only; save behavior is proved by mounted host/runtime tests, not by this visual state selector. Theme: `theme=github-light` (all contract theme IDs supported); decoration: `decoration=crt` or voxelized. Density: `density=compact` (default — today's shell) or `comfortable`; the recipes mount the real `AppViewport` and the `$app/state` stub ships the same `preferences.preferences.density` bundle, so DataTable follows it exactly as in the app. Pointer state is not a URL parameter: emulate it (CDP `Emulation.setTouchEmulationEnabled` + a 390px `setDeviceMetricsOverride`) — the coarse baseline in `app.css` and `AppViewport`'s 44px floor react to `(pointer: coarse), (max-width: 767.98px)`. `baseline-targets.json` records the measured sub-44 targets, dense surfaces and scoped escapes for spec 013 A. Locale: en/es. Browser checks include320/390/1440px, narrowed desktop container,200%text and keyboard-only controls.

## Composition contract

| Recipe           | Ownership and placement                                                                                                | Responsive behavior                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Collection/table | PageShell owns region; PageHeader title/primary task; DataView switcher in local toolbar; DataTable owns query/columns | Header title ellipsizes, actions wrap; only table region may scroll horizontally |
| Calendar         | Actual Calendar page; view-specific toolbar controls its time window; shared DataView selects presentation             | Actual container adapts independently from viewport                              |
| Board            | BoardView owns groups and move menu; card snippet owns record content                                                  | Columns scroll inside their region; move menu is keyboard/touch alternative      |
| Gallery          | CSS grid composes shared Cards; one record action per card                                                             | Columns collapse intrinsically; long labels wrap                                 |
| Detail/inspector | Main record and bounded contextual aside in SectionShell                                                               | Inspector stacks when width is insufficient                                      |
| Form             | Reading-width PageBody; field helper persists with error; footer owns commit/cancel                                    | Fields fill width; footer wraps without hiding commit                            |
| Dashboard        | EditableGrid owns constrained geometry/personal layout; card owns content                                              | Container-driven compact mode; keyboard arrangement parity                       |
| Workspace        | SectionShell owns navigation/content; each region has one scroll owner                                                 | Navigation stacks; content remains shrinkable                                    |

## Component API rules

Keep DataView headless. Its nonempty view catalog owns only selection; PageShell/PageHeader/PageBody own composition. Collection and calendar already have distinct valid placements, so these pilots do not justify a new wrapper. DataTable uses logical activation separate from selection; callers never recover record identity from DOM indices. Explicit false overrides a preset. Grid customization is constrained, identity-scoped and versioned; a personal choice never overrides organization visibility or permissions.

Use an explicit `dirty` baseline for Dialog content driven by custom controls. Initialization, search and programmatic rebaseline are not edits. ErrorSummary is submitted validation feedback; links target the same field IDs as inline errors. Destructive confirmation names the entity, preserves failure, blocks duplicates while busy and disables replay after uncertain outcomes. Acknowledged mutation with failed refresh retries only the read.

## Maturity and migration

The shared package README records primitive lifecycle. These composed recipes are candidate reference patterns until their implementation receipt includes actual archive hashes, mounted tests and browser cells. A route inventory is not a completed migration. Promote a recipe to qualified only with named route, locale, viewport, keyboard, failure/recovery and package evidence. Deprecate APIs with a documented replacement and compatibility window; do not remove public props merely because a new recipe exists.
