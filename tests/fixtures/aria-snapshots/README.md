# Aria snapshots

This fixture mounts five production widgets with synthetic fixed data: `DataTable`, the
booking calendar, `BoardView`, the house `Picker` and the command palette. One page; the
`w` query parameter picks the widget (`/?w=datatable`, `calendar`, `board`, `picker`,
`palette`). It exercises no authentication, server, gateway or customer data.

`tests/e2e/ui-audit/aria-snapshots.spec.ts` compares what each widget gives a screen reader
(roles, names, states, reading order) with the files in `tests/e2e/ui-audit/aria-snapshots/`.
It runs as the third suite of the `specs` gate: `bun run a11y --only specs`.

What is real: the components, the compiled translations (`bun run i18n:compile`) and the route
registry the palette reads. What is replaced: SvelteKit's `$app/*` and `$env/*` modules, by the
Vitest stubs in `src/server/test-utils/env-stubs/` (`$app/environment` by the file here, so
`browser` is true). Requests to `/api/*` answer 404 in the spec.

## When a snapshot fails

The failure prints a diff of the accessibility tree. If the change is intended, regenerate and
review the file diff like any other change to what users hear:

```sh
export MINION_ARIA_FIXTURE_OUT="$(mktemp -d)/out"
node tests/fixtures/aria-snapshots/build.mjs
python -m http.server 18908 --bind 127.0.0.1 --directory "$MINION_ARIA_FIXTURE_OUT"
```

In another shell:

```sh
MINION_ARIA_URL=http://127.0.0.1:18908 \
  node node_modules/@playwright/test/cli.js test --config playwright.aria.config.ts --update-snapshots
```

On update the spec writes the exact tree itself. Playwright's own writer turns every number
into a pattern, which would pin neither a time nor a date.

The clock is fixed at 2026-01-14 10:00, the locale is `en-US`, the time zone is `America/Lima`
and the viewport is 1280×800. Chromium only.

## Limits

- Adding a route to the palette changes `palette-open.aria.yml`. That is intended: regenerate.
- The tree does not carry `aria-sort` or which cell has focus, so the sorted table is pinned by
  its row order and keyboard position is not pinned (the `patterns` gate covers keyboard).
