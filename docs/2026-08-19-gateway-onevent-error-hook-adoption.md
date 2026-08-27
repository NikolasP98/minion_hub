# `onEventError` adoption in hub (S1 of the consumer-adoption spec)

Spec: `2026-08-19-gateway-client-error-hook-consumer-adoption-spec` (minion-meta), Slice 1.
Parent proposal (open-items ledger for this work):
`proposals/2026-08-17-gateway-client-error-hook-consumer-adoption.md` in minion-meta.

- **Status:** `blocked-on-publish`
- **Merge posture:** this branch **does not complete Slice 1's dependency adoption** and must not be
  recorded as S1 complete. S1 as written _is_ the dependency bump; that bump is still impossible
  (§1, re-verified 2026-08-20 08:00 UTC) and is not claimed here. What ships is the hub-owned
  containment (§3a), reviewable on its own merits as hardening. Whether to land that hardening now
  or hold the whole slice for the publish is the human decision recorded in §5 — the fail-closed
  default, applied here, is: the record stays `blocked-on-publish`, no dependency line moves, and
  §4's `TODO(handoff)` stays open.
- **What that status covers:** the **dependency adoption only**. `package.json` still declares
  `"@minion-stack/shared": "^0.9.0"` and `bun.lock` still resolves `0.9.0`, because no published
  build of that package declares `onEventError` (§1, re-polled 2026-08-20). That bump cannot be made
  from this repo and this branch does not claim it.
- **What this branch does deliver:** the half of S1's outcome hub owns — the gateway event path no
  longer loses handler failures. `src/lib/services/gateway/event-dispatch.ts` contains a failing
  `onEvent` handler at hub's own dispatch site and reports it exactly once through the app-wide
  console interceptor, without touching connection state (§3).
- **Posture on the hook itself:** `accepted-default` — hub will **not** pass `onEventError` when the
  bump eventually lands. Hub's own containment runs first, so in practice the shared client's
  fallback becomes a backstop for anything hub does not contain (§3).
- **Enforced by:** `scripts/shared-onevent-error-gate.test.ts` — it flips red the moment an installed
  `@minion-stack/shared` build declares the hook while this record still says `blocked-on-publish`,
  and it also fails if the dispatch site stops containing handler failures.

## 1. S0 gate — RED, re-polled 2026-08-20 08:00 UTC (review round 4)

The dependency bump S1 asks for still cannot be made: no published `@minion-stack/shared` exports
`onEventError`. Evidence, all re-runnable, re-run in full for this round:

| Check                                                                                                         | Result                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gh api '…/contents/packages/shared/src/gateway/client.ts?ref=main'` \| `base64 -d` \| `grep -c onEventError` | `0` — the hook is still only on `dev`, where the same command finds it at `:38` (declaration) and `:305` (dispatch); PR #29 merged 2026-08-19T03:11:35Z with base `dev` |
| `gh pr list --repo NikolasP98/minion-meta --state merged --base main --json number,title,mergedAt`            | newest merged `chore: version packages` is still **#18**, merged 2026-08-13T17:03:01Z (the 0.10.0 release); nothing merged to `main` since                              |
| `gh pr list --repo NikolasP98/minion-meta --state open --json number,baseRefName`                             | four open PRs; the only one based on `main` is **#76** (`feat(skills)`), which carries no shared-package change — no `dev` → `main` promotion PR exists                 |
| `npm view @minion-stack/shared versions --prefer-online`                                                      | `… 0.8.1, 0.9.0, 0.10.0`; `dist-tags.latest` = `0.10.0`, published 2026-08-13T17:03:43Z                                                                                 |
| `npm pack @minion-stack/shared@0.10.0 --prefer-online` → `package/dist/gateway/client.d.ts`                   | re-unpacked this round: `:19` declares `onEvent?:` only; `grep -rn onEventError package/dist/` finds nothing                                                            |
| installed `node_modules/@minion-stack/shared`                                                                 | version `0.9.0`; same declaration shape — `onEvent?:` at `:19`, no `onEventError`                                                                                       |

Per the spec's §5 S0 ("If the Version-Packages PR is absent … **stop** — S1–S3 do not start") and §7
("S1–S3 must not route around it with a git/tarball dependency"), the bump is deferred. Note that
this repo does vendor other meta-repo packages as `file:deps/*.tgz` (`@minion-stack/db`,
`@minion-stack/ui`, `@minion-stack/design-tokens`); that route is available but is explicitly
forbidden for this hook, so it was not used.

**Re-polled again 2026-08-27** (branch rebased onto `master` for staleness, no code/doc content
change beyond this note): `npm view @minion-stack/shared versions --prefer-online` still ends at
`0.10.0`; `dist-tags.latest` is still `0.10.0`; `gh api '…/contents/packages/shared/src/gateway/client.ts?ref=main'`
still finds zero `onEventError` matches; `gh pr list --repo NikolasP98/minion-meta --state merged --base main`
still tops out at #18; the only open PR based on minion-meta `main` is still #76, with no
shared-package change. Nothing about the gate moved. `package.json` still pins `^0.9.0`, `bun.lock`
still resolves `0.9.0`, and `scripts/shared-onevent-error-gate.test.ts` still passes with
`recordedStatus === 'blocked-on-publish'`.

### Why waiting inside this repo cannot turn the gate green

Publishing is two merges to minion-meta `main`
(`/memory/MINION/minion-meta-changeset-release-flow.md`): (1) promote the feature branch _and_ its
changeset from `dev`, then (2) merge the automated Version-Packages PR, whose merge triggers
`changeset publish`. PR #29 put `onEventError` and `.changeset/gateway-client-event-error-hook.md`
on `dev` at 03:11 UTC on 2026-08-19; merge (1) still has no open PR, so merge (2) cannot have been
generated and the release workflow cannot have run. The gate is not "pending a build" — the release
chain has not started, and no amount of re-polling from `minion_hub` advances it. Chasing that
pipeline is the parent spec owner's job, not this slice's (spec §7, "Retrying S0 indefinitely as this
spec's job").

## 2. Slice-0 recon (the spec's mandatory questions, answered from this checkout)

| Question                                             | Answer                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Version pinned?                                      | `package.json:24` → `"@minion-stack/shared": "^0.9.0"`; `bun.lock` resolves `0.9.0`; `node_modules/@minion-stack/shared/dist/gateway/client.d.ts:19` has `onEvent?:` and no `onEventError`                                                                                                                                    |
| Where is the client built?                           | `src/lib/services/gateway.svelte.ts` `buildGatewayClient()` — the single `new GatewayClient({…})` site, shared by `wsConnect` and the cutover backup client                                                                                                                                                                   |
| Is hub's `onEvent` wrapped in its own `try`/`catch`? | **It is now, on this branch.** It was not before: the dispatch site called `handleEvent(frame)` unguarded. It now calls `dispatchGatewayEvent(frame, handleEvent)` (§3)                                                                                                                                                       |
| What happens to a throw with the installed client?   | `0.9.0` (and `main`'s source at `:263`) dispatch with `void Promise.resolve(this.opts.onEvent?.(frame)).catch(() => {})`. A **synchronous** throw escapes before the promise wrapper and surfaces as an uncaught error on the socket message handler; an **async** rejection is swallowed by the empty `catch`. §3 stops both |
| Is `gateway-errors.ts` a valid sink?                 | **No.** `describeGatewayError` maps WS close/connect reasons to `{title, hint, raw, cta}` for the connection status UI. Routing handler failures there would violate the spec's invariant 5 (a handler failure is not a disconnection)                                                                                        |
| Is there a generic sink?                             | **Yes.** `src/lib/utils/console-interceptor.ts` — `installInterceptor()` patches `console.log/warn/error/info` into a 100-entry ring buffer; installed app-wide in `src/routes/+layout.svelte` (`onMount`, before `wsConnect`), drained by `src/lib/state/ui/bug-reporter.svelte.ts` into bug reports                         |

## 3. Decision: contain in hub now, accept the client default later

Two decisions, recorded together because they interact.

**a. Hub contains its own handler failures (shipped on this branch).**
`src/lib/services/gateway/event-dispatch.ts` wraps the `handleEvent` call. A synchronous throw is
caught; a returned thenable's rejection is caught when it settles; either produces exactly one
`console.error` tagged `[gateway] onEvent handler failed (event=…, seq=…)`, which the app-wide
interceptor captures into the bug-report buffer. The failure is never rethrown, so one bad event
cannot abort the socket's message loop, and connection-health state (`conn.connected`,
`connectErrorHint`, …) is deliberately untouched — spec invariant 5.

This is the conservative option under a blocked prerequisite. The alternative was to leave the event
path losing failures for an unbounded wait on an external publish, which is the exact defect the
parent spec exists to remove. It is not a route around S0: it changes no dependency, adds no
git/tarball pin, and introduces no new reporting subsystem — it reuses hub's only generic sink.

**b. Hub will not pass `onEventError` when the bump lands (`accepted-default`).**

- The client's fallback writes to `console.error`, which already reaches hub's only generic reporting
  surface. Wiring the hook to a hand-rolled sink would add a second path to the same destination.
- Every other candidate in hub is connection-health state and is disqualified by invariant 5.
- Introducing a new reporting subsystem is out of scope (spec §7).
- With (a) in place, hub contains failures before the client ever sees them, so the client's fallback
  is a backstop rather than the primary path. Reports stay single: hub emits one, the client emits
  none for a contained failure.

### What is proved, and what is not

- **Proved.** `src/lib/services/gateway/event-dispatch.test.ts` exercises the shipped module: a
  synchronous throw does not escape, an asynchronous rejection is reported once, success paths stay
  silent, and — through the real `console-interceptor` module, not a stand-in — a contained failure
  lands as exactly one `error` entry in the buffer `bug-reporter.svelte.ts` reads. Containment holds
  for values engineered to break the report itself (a thrown or rejected value that defeats both
  `JSON.stringify` and `String()`, a throwing `then` accessor, a console sink that throws): the
  dispatcher neither throws nor leaves an unhandled rejection.
  `src/lib/utils/console-interceptor.test.ts` pins the sink itself (capture, stacks, ring-buffer cap,
  idempotent install, and the `[unserializable]` last resort).
- **Unproved — the artifact does not exist.** How a real hook-bearing `GatewayClient` behaves cannot
  be tested here: no installed or published build contains `onEventError`. That claim must be checked
  against the real client as part of the bump, not inherited from this record. Note that with (a) in
  place the interesting case is the _absence_ of a duplicate report, which is what step 4 below asks
  for.

## 4. `TODO(handoff)` — the exact remaining steps, in order

1. **In minion-meta (not this repo, not this slice):** open and merge `dev` → `main` carrying
   `packages/shared/src/gateway/client.ts` + the changeset; then merge the `chore: version packages`
   PR that changesets raises; then confirm the release workflow run concluded `success`.
2. **In this repo:** re-run the §1 table. It goes green only when
   `npm view @minion-stack/shared@<version> --prefer-online` resolves and that version's registry
   tarball declares `onEventError` in `package/dist/gateway/client.d.ts`.
3. Bump `@minion-stack/shared` in `package.json` + `bun.lock` to that exact version, flip **Status**
   above to `adopted`, keep the accepted-default posture of §3b (do not pass `onEventError`), keep the
   containment of §3a, and re-run the spec's frozen-install / declaration / `bun run check` /
   `bun run build` gates.
4. Replace §3's "Unproved" clause with a real check against the hook-bearing client: one failing hub
   handler must still produce exactly **one** intercepted `console.error` (hub's, not a duplicate from
   the client fallback) and must leave `conn.connected` untouched (spec invariant 5).

`scripts/shared-onevent-error-gate.test.ts` fails the moment an installed build declares the hook
while this record still says `blocked-on-publish`, and separately if the dispatch site drops its
containment, so steps 3 and 4 cannot be half-done silently. Ledger entry: the parent proposal named
above.

## 5. Review findings → what changed

Four consecutive reviews of this branch returned FAIL.

**Round 4 (latest).** Two Medium findings:

| Finding                                                                                                                                                                                                                         | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _"Slice 1 still does not adopt the hook-bearing client"_ — keep the PR blocked rather than treating it as completed S1                                                                                                          | Accepted as written, fail-closed: the S0 gate was re-run in full for this round (§1, 2026-08-20 08:00 UTC) and is still RED — no published build declares `onEventError`, and no `dev` → `main` promotion PR exists. No dependency line moved: `package.json` still declares `^0.9.0` and `bun.lock` still resolves `0.9.0`. The record now carries an explicit **Merge posture** bullet stating this branch does not complete S1's dependency adoption, and `scripts/shared-onevent-error-gate.test.ts` asserts that bullet is present while the status is `blocked-on-publish`, so the framing cannot drift silently either. Doc commit below |
| _"Reporting can defeat the dispatcher's containment guarantee"_ — a thrown value that defeats `JSON.stringify` **and** `String()` makes the interceptor throw while the dispatcher reports it, so the failure escapes after all | Fixed in `8395adb`. `safeStringify` guards its `String()` fallback and ends at the constant `[unserializable]`; the patched console's capture body is wrapped; `reportHandlerFailure` is total (constant-only retry, then silence); and the `isThenable`/`Promise.resolve` step is guarded because reading `.then` runs user code outside the handler call's own `try`. Seven tests over the shipped modules cover hostile thrown and rejected values, a throwing `then` accessor and a throwing console sink, asserting no throw and no unhandled rejection; all seven are red without that commit                                             |

**Rounds 1–3.** Their findings and the responses that stand:

| Finding (latest review)                                                                                                                        | Response                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _"Slice 1 still leaves hub on the pre-hook gateway client"_ — the event path keeps escaping synchronous throws and swallowing async rejections | The dependency half is genuinely impossible from this repo and stays deferred (§1 re-polled 2026-08-20, still red). The behavioural half is now delivered hub-side by §3a, so the impact the finding names — unreported handler failures on the production event path — is gone on the installed client. This is the conservative fail-closed option under a blocked prerequisite: contain and report, never rethrow, never touch connection state |
| _"The ui-audit inventory/workflow/baseline changes are outside S1 and should travel separately"_                                               | Dropped. `master` has since landed its own fix for the same ledger problem (skip the provenance assertion when the pinned commit is unreachable), so merging `master` in resolved those files to `master`'s versions. The branch diff is now S1-only                                                                                                                                                                                               |
| _"The changed-file Prettier gate fails"_ (round 3)                                                                                             | Fixed in `748e661`; the gate is re-run and clean on every file this branch touches                                                                                                                                                                                                                                                                                                                                                                 |
| _"expected 'HEAD' to be '0a7bf5ac…'"_ self-test failure                                                                                        | Resolved by the same `master` merge — `master`'s `scripts/ui-audit-inventory.test.ts` skips the provenance assertion in a shallow clone. Full suite: 360 files / 2,912 tests pass                                                                                                                                                                                                                                                                  |

### Decision point for the human reviewer

Reviews 1–4 asked for this branch to be held rather than completed, because S1 as written _is_ the
dependency bump. That bump is still blocked and is not claimed here. What changed is the scope of
what ships alongside the blocker: rather than waiting on an external publish with the event path
unguarded, hub now owns its own containment (§3a). If the intended reading of S1 is "the dependency
line and nothing else", §3a can be reviewed as a standalone hardening change and the dependency bump
tracked by §4's `TODO(handoff)`; the two are independent and §3a does not pre-empt or complicate the
bump.

**The open question is therefore a merge decision, not an implementation one**, and it needs a human:

- **Option A — land §3a now, keep S1 open.** The event path stops losing handler failures on the
  installed client today; the dependency bump remains §4's `TODO(handoff)` and the status stays
  `blocked-on-publish`. Cost: S1 closes in two steps instead of one.
- **Option B — hold the whole branch until the publish.** S1 lands as a single change matching the
  spec's wording. Cost: the event path keeps losing handler failures for as long as the external
  release chain takes, which is the defect the parent spec exists to remove.

Applied here, fail-closed, until that decision is made: nothing about the dependency is claimed or
changed, the status stays `blocked-on-publish`, and the branch is not to be recorded as S1 complete
under either option.
