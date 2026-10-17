# Design-lint ratchet

Both `bun run lint:design` and `bun run lint:design:ci` report the historic repository snapshot and enforces
the changed-file ratchet:

1. The repository totals in `.design-lint-baseline.json` are GOVERNED counts (raw
   hits minus reason-coded exceptions). `lint:design` reports the delta;
   `lint:design:ci` runs with `--strict-global`, so a total above its ceiling fails
   CI. Lower a ceiling with `--update-baseline` after a migration; it never rises.
2. Every changed file is compared with `DESIGN_LINT_BASE_REF`, `GITHUB_BASE_REF`,
   or `origin/master`. Governed debt may decrease, never increase or move files.
3. `--update-baseline` is decrease-only. It refuses to replace the snapshot when
   any rule total is higher. `--strict-global` is available for the final zero-debt
   certification once the integration branch is below the historical snapshot.

New untracked files are compared with zero. CI must fetch its target ref; a missing
base is a gate failure rather than an implicit pass.

Exceptions live in `design-lint-exceptions.json` and require an exact file, rule,
numeric allowance, category, and human reason. Allowed categories are illustrations,
theme previews, syntax/data visualization, and third-party render surfaces. An
allowance is a cap, not a blanket file exclusion: the per-file gate catches growth
beyond it.

Run locally:

```bash
bun run lint:design
bun run lint:design:ci -- --base-ref origin/master
```

Only run `node scripts/design-lint.mjs --update-baseline` after a migration lowers
the repository totals. The command intentionally cannot accept existing regression.

`raw-control-height` flags a `height`/`min-height` CSS declaration or a Tailwind
`h-*`/`min-h-*` class (arbitrary `[…]` or the plain numeric scale) whose resolved
length falls in the 20–48px control-height band (1.25rem–3rem) outside
`src/lib/components/ui/` and isn't a `var(--control-height-*)`/`var(--…)` token —
that band is exactly the control-height scale (`--control-height-xs/sm/md/lg/touch`),
so a raw value there is almost always a drifted control, not a one-off. Unlike the
other rules it filters regex matches by parsed pixel value (see `filter` in
`RULES`), since the violation is range-based rather than syntax-based.

Styles in `.css` participate in the same per-file ratchet as Svelte styles. The app theme token definition file keeps its explicit raw-color exemption; other token rules still apply. A missing base is a failure locally as well as in CI.
