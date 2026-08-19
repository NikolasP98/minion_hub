# `onEventError` adoption in hub (S1 of the consumer-adoption spec)

Spec: `2026-08-19-gateway-client-error-hook-consumer-adoption-spec` (minion-meta), Slice 1.
Parent proposal (open-items ledger for this work):
`proposals/2026-08-17-gateway-client-error-hook-consumer-adoption.md` in minion-meta.

- **Status:** `blocked-on-publish`
- **Posture:** `accepted-default` — hub will **not** pass `onEventError`; the shared client's
  `console.error` fallback is already captured by hub's app-wide console interceptor.
- **Enforced by:** `scripts/shared-onevent-error-gate.test.ts` (flips red the moment an installed
  `@minion-stack/shared` build declares the hook while this record still says `blocked-on-publish`).

## 1. S0 gate — RED as of 2026-08-19

The dependency bump that S1 asks for cannot be made: no published `@minion-stack/shared` exports
`onEventError`. Evidence, all re-runnable:

| Check | Result |
| --- | --- |
| `gh api repos/NikolasP98/minion-meta/contents/packages/shared/src/gateway/client.ts -f ref=main` \| `grep onEventError` | no match — the hook is still only on `dev` (PR #29, merged 2026-08-19T03:11:35Z, base `dev`) |
| `gh pr list --repo NikolasP98/minion-meta --state merged` | newest `chore: version packages` is **#18**, merged 2026-08-13 (the 0.10.0 release); no Version-Packages PR after #29 |
| `npm view @minion-stack/shared versions --prefer-online` | `… 0.8.1, 0.9.0, 0.10.0` — 0.10.0 is latest |
| registry tarball of `@minion-stack/shared@0.10.0` → `package/dist/gateway/client.d.ts` | declares `onEvent?:` only; **no `onEventError`** |

The spec calls S0 "a polling gate, not a one-shot check", so it was re-run in full on 2026-08-19
(this branch's second attempt): `main` still has no `onEventError`, `npm view … versions
--prefer-online` still ends at `0.10.0`, and that release's registry tarball still declares
`onEvent?:` at `package/dist/gateway/client.d.ts:19` and nothing else. Gate unchanged: RED.

Per the spec's §5 S0 ("If the Version-Packages PR is absent … **stop** — S1–S3 do not start") and §7
("S1–S3 must not route around it with a git/tarball dependency"), the bump is deferred. Note that
this repo does vendor other meta-repo packages as `file:deps/*.tgz` (`@minion-stack/db`,
`@minion-stack/ui`, `@minion-stack/design-tokens`); that route is available but is explicitly
forbidden for this hook, so it was not used.

## 2. Slice-0 recon (the spec's mandatory questions, answered from this checkout)

| Question | Answer |
| --- | --- |
| Version pinned? | `package.json:24` → `"@minion-stack/shared": "^0.9.0"`; `bun.lock:412` resolves `0.9.0`; `node_modules/@minion-stack/shared/dist/gateway/client.d.ts:19` has `onEvent?:` and no `onEventError` |
| Where is the client built? | `src/lib/services/gateway.svelte.ts:302` `buildGatewayClient()` — the single `new GatewayClient({…})` site, shared by `wsConnect` and the cutover backup client |
| Is hub's `onEvent` wrapped in its own `try`/`catch`? | **No.** `gateway.svelte.ts:381-390` fences on `getClient() !== client`, stamps `gw.lastSeq`, then calls `handleEvent(frame)` unguarded (the spec recorded this as unverified) |
| What happens to a throw today? | Installed `0.9.0` dispatches with `void Promise.resolve(this.opts.onEvent?.(frame)).catch(() => {})`. A **synchronous** throw escapes before the promise wrapper and surfaces as an uncaught error on the socket message handler; an **async** rejection is swallowed silently by the empty `catch` |
| Is `gateway-errors.ts` a valid sink? | **No.** `describeGatewayError` maps WS close/connect reasons to `{title, hint, raw, cta}` for the connection status UI. Routing handler failures there would violate the spec's invariant 5 (a handler failure is not a disconnection) |
| Is there a generic sink? | **Yes.** `src/lib/utils/console-interceptor.ts` — `installInterceptor()` patches `console.log/warn/error/info` into a 100-entry ring buffer; installed app-wide in `src/routes/+layout.svelte:58` (`onMount`), drained by `src/lib/state/ui/bug-reporter.svelte.ts:62` into bug reports |

## 3. Decision: accepted-default

Hub takes the `console.error` fallback deliberately, and does not pass `onEventError`.

- The fallback's output already reaches hub's only generic reporting surface — the interceptor
  captures every `console.error` into the bug-report buffer — so wiring the hook to a hand-rolled
  sink would add a second path to the same destination.
- Every other candidate in hub is connection-health state (`conn.connectErrorHint` / `…Raw` /
  `…Cta`) and is disqualified by invariant 5.
- Introducing a new reporting subsystem is out of scope (spec §7).
- `src/lib/utils/console-interceptor.test.ts` proves the mechanism this posture depends on: a
  `console.error` emitted after `installInterceptor()` lands in the buffer that the bug reporter
  reads, with the message text intact.

Once a published build declares the hook, completing S1 is: bump `@minion-stack/shared` in
`package.json` + `bun.lock`, flip **Status** above to `adopted`, and leave
`buildGatewayClient` alone. No source change is required by this posture.
