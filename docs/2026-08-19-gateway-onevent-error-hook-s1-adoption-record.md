# `onEventError` adoption in hub — S1 recon and decision record

Spec: `2026-08-19-gateway-client-error-hook-consumer-adoption-spec`, Slice 1 (`minion_hub`).
Recorded 2026-08-19 from this checkout.

**Outcome in one line:** hub's posture is **accepted-default** (no wiring, the shared client's own
`console.error` fallback), and the dependency bump that S1 also asks for is **blocked** — the spec's
S0 publish gate is red, so no published `@minion-stack/shared` exports `onEventError` yet.

---

## 1. S0 gate: red (verified, not assumed)

S0 requires that the release carrying `onEventError` has actually published. It has not.

| S0 check                              | Command                                                                                                                                                                   | Observed 2026-08-19                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Hook promoted to `minion-meta` `main` | `gh api -X GET repos/NikolasP98/minion-meta/contents/packages/shared/src/gateway/client.ts -f ref=main -H 'Accept: application/vnd.github.raw+json' \| rg 'onEventError'` | **no match** — the hook is on `dev` only (PR #29, merged 2026-08-19T03:11:35Z)                             |
| Version-Packages PR after #29         | `gh pr list --repo NikolasP98/minion-meta --state merged --limit 100 --json number,title,mergedAt`                                                                        | **none** — the newest `chore: version packages` is **#18**, merged 2026-08-13T17:03:01Z, i.e. _before_ #29 |
| Registry has a hook version           | `npm view @minion-stack/shared versions --prefer-online`                                                                                                                  | `0.1.0 … 0.9.0, 0.10.0`; `dist-tags.latest = 0.10.0`, published 2026-08-13T17:03:43Z                       |
| Latest tarball declares the hook      | `curl -fsSL "$(npm view @minion-stack/shared@0.10.0 dist.tarball --prefer-online)" \| tar -xzO package/dist/gateway/client.d.ts \| rg 'onEventError'`                     | **no match** (only `onEvent?: (frame: EventFrame) => void \| Promise<void>`)                               |

Per the spec's own ship gate ("If the Version-Packages PR is absent, the release workflow failed, or
the registry artifact lacks the declaration, **stop** — S1–S3 do not start") and its out-of-scope
clause ("S1–S3 must not route around it with a git/tarball dependency"), hub does **not** bump and
does **not** substitute a git or tarball dependency. Chasing the release is the parent spec
(`2026-08-17-pkg-gateway-client-onevent-errors-spec`) owner's job, not this slice's.

## 2. Recon inside `minion_hub` (the "unverified — repo absent" grid, filled in)

| Question the spec asked                                      | Answer                                                                                                                                                                                                                                                          | Evidence                                                                                                                                           |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which file constructs the `GatewayClient`?                   | `buildGatewayClient`, used by both `wsConnect` (main client) and `cutoverToHost` (make-before-break backup)                                                                                                                                                     | `src/lib/services/gateway.svelte.ts:302`, `:303`, `:542`, `:649`                                                                                   |
| Is hub's `onEvent` already wrapped in its own `try`/`catch`? | **No.** It fences on the current client, records `frame.seq`, then calls `handleEvent(frame)` unguarded                                                                                                                                                         | `src/lib/services/gateway.svelte.ts:383`                                                                                                           |
| Can `handleEvent` actually throw?                            | Yes. It is an unguarded `switch` over unvalidated payloads with unchecked casts — e.g. `cache.invalidate` does `const { tags } = evt.payload as { tags: string[] }` then `for (const tag of tags)`, which is a `TypeError` on a missing or non-iterable payload | `src/lib/services/gateway.svelte.ts:818` onward                                                                                                    |
| What version is pinned?                                      | `"@minion-stack/shared": "^0.9.0"`, lockfile resolves `0.9.0`                                                                                                                                                                                                   | `package.json:24`, `bun.lock:412`                                                                                                                  |
| Is `gateway-errors.ts` still connection-specific?            | Yes. Its only export is `describeGatewayError(rawReason)`, which maps WS close/connect _reasons_ to a title/hint/CTA for the status-dot UI                                                                                                                      | `src/lib/services/gateway-errors.ts:32`                                                                                                            |
| Is there a generic (non-connection) error sink to wire into? | **No.** `posthog-js` is used for product analytics only (`skill_published`, `skill_ai_generated`); `src/lib/server/posthog.ts` is server-side; `toastError` is UI, which S1 forbids. There is no client-side error-reporting module                             | `src/lib/state/builder/skill-editor.core.svelte.ts:280`, `src/lib/state/builder/skill-editor.proposals.svelte.ts:145`, `src/lib/server/posthog.ts` |
| What does the pinned client do with a handler failure today? | `void Promise.resolve(this.opts.onEvent?.(frame)).catch(() => {})` — an async rejection is discarded silently; a synchronous throw escapes into the socket's `message` listener                                                                                 | `node_modules/@minion-stack/shared/dist/gateway/client.js:215`                                                                                     |

## 3. Decision: accepted-default

S1 says: _"If no generic sink exists, accept the default; introducing a new UI/reporting subsystem is
outside this slice."_ Recon row 6 shows hub has no such sink, and the spec explicitly rules out the
surfaces hub does have:

- Connection-health state (`connectErrorHint`/`connectErrorRaw`/`connectErrorCta`) and
  `describeGatewayError` are invalid targets — invariant 5: an `onEvent` handler failure does not
  mean the socket disconnected, so it must not make a healthy connection look down.
- A toast/banner is out of scope ("UI for event-handler failures in any consumer").
- Product analytics is a new reporting subsystem, also out of scope.

So when the bump eventually lands, hub leaves `onEventError` unset and takes the shared client's
`console.error` fallback. **The new console output is the accepted, recorded outcome — not a
regression to file.** Nothing in `gateway.svelte.ts` changes at that point except deleting the
`TODO(handoff)` at `:371`.

Also fixing hub's own unguarded `onEvent`/`handleEvent` (the swallow class flagged as an open audit
item by `2026-08-17-site-member-gateway-swallowed-errors-spec` ⚠️ A2) is explicitly out of scope
here and stays open.

## 4. What shipped in this slice

- `src/lib/services/gateway/event-dispatch-contract.test.ts` — a probe against the **shipped**
  `GatewayClient` (fake browser-shaped socket, real challenge handshake) pinning the three invariants
  the accepted-default posture rests on: a failing handler triggers no `onClose` and no reconnect and
  leaves the socket open (invariant 5); later frames still arrive in order (invariant 2); an async
  handler rejection does not leak as an unhandled rejection. These hold on `0.9.0` _and_ must hold
  after the bump, so the file is a bump-survivable gate rather than a snapshot of today's swallow. It
  deliberately does not assert whether a _synchronous_ throw is contained — that is exactly the
  behaviour the pending release changes.
- `src/lib/services/gateway.svelte.ts:371` — `TODO(handoff)` at the construction site.
- This record.

No dependency, protocol, connection-state, or UI change: invariants 1–5 of the spec's §3 all hold
trivially because nothing was wired.

## 5. Resuming S1 when the release lands

```bash
# 1. Re-run the S0 gate (it is a polling gate, per the spec):
gh api -X GET repos/NikolasP98/minion-meta/contents/packages/shared/src/gateway/client.ts \
  -f ref=main -H 'Accept: application/vnd.github.raw+json' | rg 'onEventError'
gh pr list --repo NikolasP98/minion-meta --state merged --limit 100 \
  --json number,title,mergedAt \
  -q '.[] | select(.title == "chore: version packages" and .mergedAt > "2026-08-19T03:11:35Z")'
curl -fsSL "$(npm view @minion-stack/shared@<version> dist.tarball --prefer-online)" \
  | tar -xzO package/dist/gateway/client.d.ts | rg 'onEventError'

# 2. Bump. NOTE: the manifest range is "^0.9.0", which under caret-on-0.x cannot admit 0.10.0,
#    let alone a later hook release — the range itself must be widened, not just the lockfile
#    re-resolved.
#    Edit package.json, then: bun install && bun install --frozen-lockfile

# 3. Verify and leave the hook unset (accepted-default, §3):
node -p "require('./node_modules/@minion-stack/shared/package.json').version"
rg -n 'onEventError' node_modules/@minion-stack/shared/dist/gateway/client.d.ts   # → present
rg -n 'onEventError' src/lib/services/gateway.svelte.ts                            # → only the TODO, then delete it
bun run check && bun run build
bunx vitest run src/lib/services/gateway/event-dispatch-contract.test.ts           # → must still pass
```

## 6. Ledger

Open end, per CLAUDE.md's open-items clause: hub is not on a hook-bearing
`@minion-stack/shared`, blocked on an external publish. In-code marker is at
`src/lib/services/gateway.svelte.ts:371`. The matching minion-meta proposal entry
(`proposals/2026-08-17-gateway-client-error-hook-consumer-adoption.md`, the hub row of its recon
grid) could not be updated from here — `minion-meta` is not checked out in this workspace and this
run is scoped to `minion_hub` — so this file is the hub-side record that entry should cite.
