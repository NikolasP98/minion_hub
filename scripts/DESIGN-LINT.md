# Design-lint ratchet

`bun run lint:design:ci` reports the historic repository snapshot and enforces
the changed-file ratchet:

1. The historic repository totals are migration evidence. They may be stale when
   debt has already landed on the integration branch, so their delta is reported
   but does not fail ordinary CI or justify raising the snapshot.
2. Every changed file is compared with `DESIGN_LINT_BASE_REF`, `GITHUB_BASE_REF`,
   or `origin/dev`. Governed debt may decrease, never increase or move files.
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
bun run lint:design:ci -- --base-ref origin/dev
```

Only run `node scripts/design-lint.mjs --update-baseline` after a migration lowers
the repository totals. The command intentionally cannot accept existing regression.
