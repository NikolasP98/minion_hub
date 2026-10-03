# Dependency security browser fixture

`bun run test:dependency-browser` builds this fixture into a fresh private directory, serves it
only on `127.0.0.1:18904`, and runs the four exact Chromium cases in
`tests/e2e/dependency-security.spec.ts`. Set `PLAYWRIGHT_BROWSERS_PATH` to an absolute cache
populated by the lockfile-selected Playwright version. CI installs that version's Chromium and
uploads the entire run root even on failure.

The builder disables environment-file loading, records every Rollup module, scans both that graph
and emitted client artifacts for server-only modules and private credential markers, and writes a
digest manifest. The Playwright reporter requires DS1 through DS4 exactly once, runtime and network
evidence for each case, zero skips, a stable manifest digest, and a passing bundle-boundary receipt.
Missing browsers, build failures, absent cases, skips, and browser failures leave a failed
`runner-receipt.json`; no condition converts them into a passing unit test.
