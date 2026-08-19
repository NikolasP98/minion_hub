# `onEventError` adoption in hub (S1 of the consumer-adoption spec)

Spec: `2026-08-19-gateway-client-error-hook-consumer-adoption-spec` (minion-meta), Slice 1.
Parent proposal (open-items ledger for this work):
`proposals/2026-08-17-gateway-client-error-hook-consumer-adoption.md` in minion-meta.

- **Status:** `blocked-on-publish`
- **Slice 1 outcome:** **BLOCKED, not complete.** The dependency adoption Slice 1 exists to perform
  has **not** happened: `package.json` still declares `"@minion-stack/shared": "^0.9.0"` and
  `bun.lock` still resolves `0.9.0`, because no published version of that package declares the hook
  (§1). This branch therefore carries the S0 gate, the recon, and the recorded posture — it must not
  be read, merged, or closed out as a completed Slice 1.
- **Posture (applies once the gate goes green):** `accepted-default` — hub will **not** pass
  `onEventError`; the shared client's `console.error` fallback is captured by hub's app-wide console
  interceptor.
- **Enforced by:** `scripts/shared-onevent-error-gate.test.ts` (flips red the moment an installed
  `@minion-stack/shared` build declares the hook while this record still says `blocked-on-publish`).

## 1. S0 gate — RED, re-polled 2026-08-19

The dependency bump that S1 asks for cannot be made: no published `@minion-stack/shared` exports
`onEventError`. Evidence, all re-runnable, re-run in full on 2026-08-19 for this round:

| Check | Result |
| --- | --- |
| `gh api repos/NikolasP98/minion-meta/contents/packages/shared/src/gateway/client.ts -f ref=main` \| `grep onEventError` | no match — `main`'s `GatewayClientOptions` declares `onEvent?:` at `:27` and dispatches at `:263`; the hook is still only on `dev` (PR #29, merged 2026-08-19T03:11:35Z, base `dev`) |
| `gh pr list --repo NikolasP98/minion-meta --state merged` | newest `chore: version packages` is **#18**, merged 2026-08-13 (the 0.10.0 release); no Version-Packages PR after #29 |
| `npm view @minion-stack/shared versions --prefer-online` | `… 0.8.1, 0.9.0, 0.10.0`; `dist-tags.latest` = `0.10.0` |
| registry tarball of `@minion-stack/shared@0.10.0` → `package/dist/gateway/client.d.ts` | `:19` declares `onEvent?:` only; **no `onEventError`** |
| installed `node_modules/@minion-stack/shared` | version `0.9.0`; same declaration shape — `onEvent?:` at `:19`, no `onEventError` |

Per the spec's §5 S0 ("If the Version-Packages PR is absent … **stop** — S1–S3 do not start") and §7
("S1–S3 must not route around it with a git/tarball dependency"), the bump is deferred. Note that
this repo does vendor other meta-repo packages as `file:deps/*.tgz` (`@minion-stack/db`,
`@minion-stack/ui`, `@minion-stack/design-tokens`); that route is available but is explicitly
forbidden for this hook, so it was not used.

`TODO(handoff)`: finish S1 by bumping `@minion-stack/shared` in `package.json` + `bun.lock` to the
exact version S0 records, flipping **Status** above to `adopted`, and re-running the spec's
frozen-install / declaration / `bun run check` / `bun run build` gates. Blocked on an external
publish, so it cannot be done in this repo today; `scripts/shared-onevent-error-gate.test.ts` fails
the moment the installed build makes it possible. Ledger entry: the parent proposal named above.

## 2. Slice-0 recon (the spec's mandatory questions, answered from this checkout)

| Question | Answer |
| --- | --- |
| Version pinned? | `package.json:24` → `"@minion-stack/shared": "^0.9.0"`; `bun.lock:412` resolves `0.9.0`; `node_modules/@minion-stack/shared/dist/gateway/client.d.ts:19` has `onEvent?:` and no `onEventError` |
| Where is the client built? | `src/lib/services/gateway.svelte.ts:302` `buildGatewayClient()` — the single `new GatewayClient({…})` site, shared by `wsConnect` and the cutover backup client |
| Is hub's `onEvent` wrapped in its own `try`/`catch`? | **No.** `gateway.svelte.ts:371-389` fences on `getClient() !== client`, stamps `gw.lastSeq`, then calls `handleEvent(frame)` unguarded (the spec recorded this as unverified) |
| What happens to a throw today? | Installed `0.9.0` dispatches with `void Promise.resolve(this.opts.onEvent?.(frame)).catch(() => {})`. A **synchronous** throw escapes before the promise wrapper and surfaces as an uncaught error on the socket message handler; an **async** rejection is swallowed silently by the empty `catch`. This is unchanged by this branch and stays until the bump lands |
| Is `gateway-errors.ts` a valid sink? | **No.** `describeGatewayError` maps WS close/connect reasons to `{title, hint, raw, cta}` for the connection status UI. Routing handler failures there would violate the spec's invariant 5 (a handler failure is not a disconnection) |
| Is there a generic sink? | **Yes.** `src/lib/utils/console-interceptor.ts` — `installInterceptor()` patches `console.log/warn/error/info` into a 100-entry ring buffer; installed app-wide in `src/routes/+layout.svelte:58` (`onMount`, before `wsConnect`), drained by `src/lib/state/ui/bug-reporter.svelte.ts:62` into bug reports |

## 3. Decision: accepted-default (recorded now, effective on adoption)

Hub takes the `console.error` fallback deliberately, and does not pass `onEventError`.

- The fallback's output already reaches hub's only generic reporting surface — the interceptor
  captures every `console.error` into the bug-report buffer — so wiring the hook to a hand-rolled
  sink would add a second path to the same destination.
- Every other candidate in hub is connection-health state (`conn.connectErrorHint` / `…Raw` /
  `…Cta`) and is disqualified by invariant 5.
- Introducing a new reporting subsystem is out of scope (spec §7).
- No production source change is required by this posture, and none is made:
  `src/lib/services/gateway.svelte.ts` is byte-identical to `master` on this branch.

### What is proved, and what is not

- **Proved.** `src/lib/utils/console-interceptor.test.ts` exercises the shipped interceptor: a
  `console.error` emitted after `installInterceptor()` lands, message and stack intact, in the buffer
  `bug-reporter.svelte.ts` reads. `src/routes/+layout.svelte:58` installs it before `wsConnect`, so
  the sink is live for the whole socket lifetime.
- **Unproved — the artifact does not exist.** That a real hook-bearing `GatewayClient` emits exactly
  one intercepted report for one failing hub handler cannot be tested here: no installed or published
  build contains the fallback. The interceptor test's gateway-shaped message is a hand-written
  stand-in for the fallback's *shape*, not evidence of the client's behavior. This claim must be
  re-checked against the real client as part of the bump, not inherited from this record.

## 4. Scope note: the ui-audit changes on this branch

Commit `860108c` (`scripts/ui-audit-inventory.mjs`, `scripts/ui-audit-inventory.test.ts`,
`tests/ui-audit/current-baseline.json`, `tests/e2e/ui-audit/README.md`, `.github/workflows/ci.yml`)
is not Slice 1 work and belongs in its own change. It is retained here because removing it makes the
run's required local gate fail: the ledger on `master` pins `sourceCommit`
`0a7bf5ac61e7684321da9f6bf1ab0cc34afbbf69`, which does not exist in this clone
(`git cat-file -e` → "Not a valid object name"), so `buildRouteInventory` falls back to `HEAD` and
`bunx vitest run scripts/ui-audit-inventory.test.ts` fails with
`expected 'HEAD' to be '0a7bf5ac…'`. Reverting those files and re-running the focused test reproduces
that failure exactly. Whoever splits the branch should land the ui-audit fix first, on its own.
