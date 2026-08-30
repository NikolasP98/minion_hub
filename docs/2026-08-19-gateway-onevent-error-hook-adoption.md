# Gateway lifecycle-error hook adoption in hub

Spec: `2026-08-19-gateway-client-error-hook-consumer-adoption-spec` (minion-meta), Slice 1.
Parent proposal: `proposals/2026-08-17-gateway-client-error-hook-consumer-adoption.md`.

- **Status:** `adopted`
- **Release:** exact registry version `@minion-stack/shared@0.11.0` in both `package.json` and
  `bun.lock`.
- **Registry evidence (2026-08-30):** `npm view @minion-stack/shared version versions --json`
  reports `0.11.0`; the registry tarball's `dist/gateway/client.d.ts` declares `onEventError`,
  `onReconnectError`, and `onSocketError`; and the runtime contains guarded sync/async reporting
  paths for all three hooks.
- **Base reconciliation:** current `master` was merged into the preserved PR branch; no commit was
  rebased or discarded.

## Hub decisions for the three hooks

| Hook               | Posture            | Reason                                                                                                                                                                                                                                        |
| ------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onEventError`     | `accepted-default` | Hub's `dispatchGatewayEvent` contains and reports handler failures first, so the shared fallback remains a backstop without producing a duplicate report.                                                                                     |
| `onReconnectError` | `explicit-silent`  | Reconnect state and operator feedback already flow through `onClose` and `onReconnectScheduled`; the package hook is reporting-only. Silence prevents a sustained outage from filling the 100-entry bug-report buffer with duplicate retries. |
| `onSocketError`    | `explicit-silent`  | Socket `error` is reporting-only and `close` remains the lifecycle authority. Hub derives connection UI state from the close/connect path, so a second report would be duplicate noise.                                                       |

The two silent hooks are deliberately wired as `() => {}`. They do not alter reconnect, close, or
connection-health state. This is the package contract's explicit opt-out, not an accidental omission.

## Runtime proof

`src/lib/services/gateway/event-dispatch.test.ts` exercises the shipped dispatcher through the real
console interceptor. It covers synchronous throws, asynchronous rejections, callable thenables,
throwing `then` accessors, hostile values, and throwing report sinks. The real-client integration
case instantiates the installed `GatewayClient`, delivers an event through its WebSocket message
listener, and proves that a failing hub handler creates exactly one intercepted report without
closing the client. Because hub contains the failure before returning from `onEvent`, the shared
client's default does not emit a duplicate.

`scripts/shared-onevent-error-gate.test.ts` binds the record to the installed declarations, exact
manifest version, all three hook decisions, and hub's containment wiring. A future dependency or
posture drift therefore fails against shipped files rather than a copied implementation.

## Historical disposition

Earlier reviews correctly kept PR #132 unmerged while npm ended at `0.10.0`; the branch preserved
the hub-owned containment without claiming S1 complete. On 2026-08-30 the external prerequisite
changed: `0.11.0` was published with all three hooks. This update completes the previously deferred
dependency adoption instead of repeating the prior blocked disposition.
