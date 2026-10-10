# Hub Node notification worker release

The production runtime record shows no notification worker has started. No production installation has been verified. Vercel deploys the Hub with adapter-vercel and does not start the persistent scheduler. The worker requires a separately built adapter-node artifact and an operator-owned host service. This document defines prerequisites and rollout boundaries; it is not an activation command.

## Artifact qualification

Build from an immutable reviewed Hub commit with the frozen Bun lockfile and `DESKTOP=1`. Do not set `VITE_DESKTOP`; browser authentication must remain enabled in the bundle. Record source commit/tree, runtime versions, package and lock hashes, archive hash, dependency inventory and a secret-free manifest.

Use an explicitly marked disposable native PostgreSQL target with captured schema, never customer rows or provider credentials. Run `scripts/qc/worker-runtime-qualification.mjs` against the compiled artifact. Qualify unauthorized denial, controlled synthetic cron readiness, singleton/heartbeat ownership, cancellation and generation takeover, queued-record restart survival, and graceful SIGTERM during active work. These are runtime checks, not provider or tenant acceptance.

## Host prerequisites

Before the first production start, review and install:

- a dedicated unprivileged systemd service and root-owned deployment controller;
- loopback-only `HOST=127.0.0.1` on a dedicated port, with host listener/firewall proof;
- a root-owned mode-0600 environment containing the reviewed production DB/cache configuration and `DESKTOP=1`, while leaving `NOTIFICATION_WORKER=0` during staging;
- `TimeoutStopSec=180s` and `SendSIGKILL=no` so callbacks are never force-killed implicitly;
- an immutable artifact manifest and release directory owned outside the service account's write authority;
- a no-automatic-rollback floor that refuses an older artifact without the durable worker contract.

DESKTOP mode bypasses the normal Hub request-authentication sequence, so the adapter-node listener must not be publicly reachable.

## First activation

1. Verify the production migration ledger, catalog fingerprints, exact artifact manifest, runtime/architecture, service identity and secure environment. Read only aggregate pending/outbox counts and the existing runtime singleton; do not replay, reset, cancel or manufacture work.
2. Start the compiled server with `NOTIFICATION_WORKER=0`. Verify exact process/artifact identity, loopback listener and HTTP 401 for an unauthenticated `/api/jobs/tick` request, without making an authorized customer-work call.
3. In a separately approved production-effect window, change only the reviewed worker gate to `NOTIFICATION_WORKER=1` and restart the one owned service. Do not create a Vercel or host cron: the persistent worker loop schedules itself.
4. Verify one live singleton with the expected generation, build/catalog/projector identity and heartbeat. Confirm the health/degraded UI against aggregate state. Do not send provider test messages without a separate recipient-specific plan.
5. On failed adoption, quiesce admission, retain database/artifact evidence and use a compatible forward repair. Do not automatically start an older unfenced worker.

## Later upgrades

For an already active qualified worker, stop admission and allow the owned lifecycle to drain. Require actual process exit before switching artifacts. Preserve durable leases and records; never treat an empty HTTP connection or expired lease as proof that detached callbacks settled. Revalidate the immutable manifest and the worker floor before every start.

TODO(handoff): Add the reviewed systemd unit, root-owned immutable deployment controller and first-activation/postflight automation before production sets `NOTIFICATION_WORKER=1`; track this in proposed meta ledger `proposals/2026-10-09-hub-notification-worker-production-activation.md`.
