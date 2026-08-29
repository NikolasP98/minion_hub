# `onEventError` adoption in hub (S1 of the consumer-adoption spec)

Spec: `2026-08-19-gateway-client-error-hook-consumer-adoption-spec` (minion-meta), Slice 1.
Parent proposal (open-items ledger for this work):
`proposals/2026-08-17-gateway-client-error-hook-consumer-adoption.md` in minion-meta.

- **Status:** `blocked-on-publish`
- **Merge posture:** this branch **does not complete Slice 1's dependency adoption** and must not be
  recorded as S1 complete. S1 as written _is_ the dependency bump; that bump is still impossible
  (§1, re-verified 2026-08-29) and is not claimed here. What ships is the hub-owned containment
  (§3a), reviewable on its own merits as hardening. That was an open question for four review
  rounds; it is now settled — the 2026-08-28 supervised disposition denied the branch as S1 and
  kept it for the containment (§5). The record therefore stays `blocked-on-publish`, no dependency
  line moves, and §4's `TODO(handoff)` stays open.
- **What that status covers:** the **dependency adoption only**. `package.json` still declares
  `"@minion-stack/shared": "^0.9.0"` and `bun.lock` still resolves `0.9.0`, because no published
  build of that package declares `onEventError` (§1, re-polled 2026-08-29). That bump cannot be made
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

## 1. S0 gate — RED, last re-polled 2026-08-29

The dependency bump S1 asks for still cannot be made: no published `@minion-stack/shared` exports
`onEventError`. Evidence, all re-runnable. The table below is the round-4 run (2026-08-20 08:00 UTC);
the re-polls after it are recorded underneath, most recent last:

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

**Re-polled again 2026-08-29** (branch merged current `master` for staleness; the only content
changes this round are this note, the §5 disposition, and the date in the gate's `TODO(handoff)`).
Ten days on, the release chain still has not started:

| Check                                                                     | Result on 2026-08-29                                                                                                                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm view @minion-stack/shared versions` / `dist-tags`                    | list still ends at `0.10.0`; `latest` = `0.10.0`, published 2026-08-13T17:03:43Z — no release since                                                                                       |
| `npm pack @minion-stack/shared@0.10.0` → `grep -rl onEventError package/` | no match anywhere in the tarball; `package/dist/gateway/client.d.ts:19` still declares `onEvent?:` only                                                                                   |
| `gh api '…/contents/packages/shared/src/gateway/client.ts?ref=main'`      | zero `onEventError` matches (line 27 is `onEvent?:`; line 263 is still the swallowing `.catch(() => {})`). Repo-wide `search/code` for `onEventError` returns `total_count: 0` for `main` |
| same file at `?ref=dev`                                                   | hook present at `:38` (declaration) and `:305` (dispatch); `.changeset/gateway-client-event-error-hook.md` still sits unpromoted on `dev`                                                 |
| `gh pr list --repo NikolasP98/minion-meta --state merged --base main`     | newest `chore: version packages` is still **#18** (2026-08-13). The one newer merge to `main`, **#232** `feat(skills)` (2026-08-28), touches no `packages/shared` file                    |
| `gh pr list --repo NikolasP98/minion-meta --state open`                   | two open PRs, **both based on `dev`** (#244, #247) — still no `dev` → `main` promotion PR                                                                                                 |
| installed `node_modules/@minion-stack/shared`                             | version `0.9.0`; `onEvent?:` at `:19`, no `onEventError`                                                                                                                                  |

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
5. **Decide the two sibling hooks in the same PR** — the bump delivers three, not one (§6). The
   parent proposal's Definition of Done is "nine decisions total (3 consumers × 3 hooks), none
   implicit", so a hub PR that records only `onEventError` leaves the slice open.

`scripts/shared-onevent-error-gate.test.ts` fails the moment an installed build declares the hook
while this record still says `blocked-on-publish`, and separately if the dispatch site drops its
containment, so steps 3 and 4 cannot be half-done silently. Ledger entry: the parent proposal named
above.

## 5. Review findings → what changed

Six consecutive reviews of this branch returned FAIL.

**Round 6 (latest, 2026-08-29, cross-provider review 891244ae).** One Medium finding, restating the
same structural gap as rounds 1, 4, and 5: the branch "still resolves `@minion-stack/shared@0.9.0`,
whose published declarations have no `onEventError` hook." The finding's own text concedes the
current response is already correct — "the supervised disposition and current draft state correctly
prevent that impact today; they do not turn the missing S1 outcome into completion" — and its
"minimal fix" is to keep the PR draft and not claim S1 while the gate is red, which this record and
`scripts/shared-onevent-error-gate.test.ts` already enforce. Independently re-verified this round
(2026-08-29, ~02:19 UTC, about 20 minutes after the finding's own re-poll): `npm view
@minion-stack/shared versions` still ends at `0.10.0`; the `0.10.0` tarball's
`dist/gateway/client.d.ts` still declares `onEvent?:` only; `minion-meta` `main` still has zero
`onEventError` matches; both open `minion-meta` PRs are still based on `dev`, not `main`. No
dependency line moved, `package.json`/`bun.lock` still resolve `0.9.0`, and the record's Status stays
`blocked-on-publish`. The finding's alternative ("re-scope and retitle this same PR as
containment-only") is a PR-metadata action for the harness/human, not something this branch's diff
can do; nothing in the diff claims S1 either way (§5 "The merge decision, settled 2026-08-28").

**Round 5 (2026-08-27).** Two Medium findings; the round's own re-review confirmed the
second was fixed and left only the dependency one standing:

| Finding                                                                                                                                                               | Fix                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| _"Slice 1 still does not adopt the hook-bearing shared client"_ — keep the PR draft/blocked                                                                           | Accepted, fail-closed, and now settled by the 2026-08-28 supervised disposition below: the branch is denied as S1 and kept for the containment. §1's gate was re-polled again on 2026-08-29 and is still RED                                                                                                                                                                |
| _"Callable thenables are not contained"_ — `isThenable` required `typeof value === 'object'`, so `Object.assign(function () {}, { then })` skipped the rejection path | Fixed in `8ee5625`. `isThenable` now accepts functions as well as non-null objects before reading `.then`, matching the assimilation rule promise resolution itself uses. `event-dispatch.test.ts` covers a rejecting callable thenable and asserts it is reported exactly once; the test is red without that commit. The round's re-review (18:56 UTC) no longer raised it |

**Round 4 (2026-08-20).** Two Medium findings:

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

### The merge decision, settled 2026-08-28

Reviews 1–5 all returned FAIL for the same reason, and all for the same half of the slice: S1 as
written _is_ the dependency bump, and that bump is still blocked and is not claimed here. Rounds
2–4 also found real defects in the containment (hostile reporting, callable thenables); those are
fixed and re-proved (see the table above). What remained was never an implementation question but a
merge one, and it was answered by the supervised disposition on PR #132 (2026-08-28):

> **DENY as Slice 1; keep the branch preserved and draft.** … The hub-owned dispatcher containment
> is meaningful unique WIP and fixes real synchronous, asynchronous, hostile-reporting, and
> callable-thenable failure cases. It is not, however, the package adoption and real-client
> integration that the approved S1 Definition of Done requires. Repeated automated retries cannot
> manufacture the missing registry artifact.

So the scope of this branch is now fixed, and this record states it rather than offering options:

- **What this branch is:** hub-owned containment of gateway `onEvent` handler failures (§3a),
  defense in depth on the installed pre-hook client, reviewable on its own merits. It changes no
  dependency, adds no git/tarball pin, and introduces no new reporting subsystem.
- **What this branch is not:** Slice 1. The dependency adoption and the real hook-bearing-client
  proof stay open as §4's `TODO(handoff)`, enforced by `scripts/shared-onevent-error-gate.test.ts`.
  Merging this must not close S1 — the slice reopens at §4 step 1 the moment minion-meta publishes.
- **The PR's own title still says "error-hook adoption S1".** That framing is stale for the same
  reason; retitling PR #132 to the containment scope is a human/harness action, not one this branch
  can take. Nothing in the diff claims S1.

Under that disposition the fail-closed posture is unchanged and still applied: nothing about the
dependency is claimed or changed, the status stays `blocked-on-publish`, and the branch is not to
be recorded as S1 complete.

## 6. The bump delivers three hooks, not one — hub-side recon

Recorded 2026-08-29, from the parent proposal's own amendment (minion-meta
`proposals/2026-08-17-gateway-client-error-hook-consumer-adoption.md` on branch `dev`, "Scope
amended 2026-08-20") and from minion-meta `packages/shared/src/gateway/client.ts@dev`. The same
unpublished minor that adds `onEventError` also adds `onReconnectError` and `onSocketError`
(`:46`, `:53`), each with a `console.error` default (`:316`, `:325`). There is no partial adoption
at the package level: one bump turns all three on at once. The proposal's Definition of Done wants
an explicit posture per consumer **per hook**, so the two below are open decisions, not
afterthoughts — this record answers only what is verifiable from this checkout and leaves the
decision itself to the bump PR (§4 step 5).

| Hook               | Hub's existing surface for it                                                                                                                                                                                                          | What the default would do here                                                                                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onEventError`     | `src/lib/services/gateway/event-dispatch.ts` (§3a) — contains the failure before the client can see it                                                                                                                                 | Nothing, for anything hub contains. Posture recorded: `accepted-default` (§3b)                                                                                                  |
| `onReconnectError` | Reconnect is hub-driven state, not a report sink: `conn.backoffMs`, the eager-reconnect window (`src/lib/services/gateway/eager-reconnect.ts`), and the fatal-close CTA path. Hub sets `autoReconnect: true` (`gateway.svelte.ts:306`) | **One `console.error` per failed attempt, undeduped.** The proposal states ~240 lines/hour with the gateway down (~15s at the backoff cap). See the ring-buffer note below      |
| `onSocketError`    | `describeGatewayError` (`src/lib/services/gateway/gateway-errors.ts`) feeds the connection-status UI from close/connect reasons, not from transport `error` events                                                                     | One `console.error` per socket `error`. Reporting only — the proposal's invariant forbids driving reconnect or close from this hook, and hub already drives both from `onClose` |

⚠️ **Hub-specific consequence the accepted default has here.** Hub's only generic sink is the
console interceptor's ring buffer, and it is capped at 100 entries
(`src/lib/utils/console-interceptor.ts` `MAX_ENTRIES`). An undeduped reconnect error per attempt
evicts the whole buffer during any sustained outage, so a bug report filed _after_ one would carry
~100 identical reconnect lines and none of the context the reporter meant to capture. That is a
reason to consider wiring `onReconnectError` to something throttled rather than accepting its
default — but it is a decision for the bump PR, taken against the real client, not one this branch
can make or prove. It is written here so the bump does not take the default by omission.

Note on locations: the spec and proposal cited throughout this record live on minion-meta's `dev`
branch, not `main` — the same promotion that is blocking the publish is what keeps them off `main`.
