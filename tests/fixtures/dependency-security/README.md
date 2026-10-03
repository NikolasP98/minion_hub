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

`bun run test:dependency-browser-mutations` invokes that same runner twice with build-time
mutations. The editor mutation writes an untrusted paste fragment into the live editor DOM and must
fail only DS2. The sanitizer mutation returns the dirty fragment without DOMPurify and must fail
only DS3. Each case attaches its structured fixture result, actual browser identity and complete
network/page-error list. The outer qualifier checks the child exit, runner receipt, exact four-case
report, client-boundary proof, bundled mutation identity, exact failed invariant, parsed evidence
content, absence of unrelated errors, and clean server shutdown before it writes a passing
`mutation-qualification-receipt.json`. A failure in navigation, a hook, another fixture assertion or
the network boundary cannot substitute for the forced security regression.
