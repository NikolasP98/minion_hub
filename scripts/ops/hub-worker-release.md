# Hub Node worker release

The Vercel deployment does not update the separate Node adapter worker used by
Netcup cron. Build it from an immutable reviewed Hub commit with the frozen Bun
lockfile and `DESKTOP=1`. Do not set `VITE_DESKTOP`: browser authentication must
remain enabled. Record source/tree, runtime versions, package/lock hashes, archive
hash, dependency inventory, and the installed server's matching manifest.

## Qualification

Use an explicitly marked disposable native PostgreSQL target with captured schema,
never customer rows or provider credentials. Exercise the compiled Node endpoint:
unauthorized cron returns401; an owned synthetic cron credential returns200;
heartbeat renews live ownership; cancellation and generation takeover refuse stale
effects; a queued record survives graceful restart. Label controlled handlers as
runtime qualification, not provider or full domain acceptance.

Send SIGTERM to the owned fixture during an active callback. Verify that HTTP stops
accepting connections, admission stops, the callback finishes its fenced work,
resources close, and the process exits naturally. Retain the unmodified baseline
receipt: its pool kept the process alive120seconds, exceeding the deployed90second
stop policy. Test clean startup as well as active and lease-lost callbacks.

## Existing worker transition

1. Back up the scheduler privately with mode0600. Pause only the jobs invocation;
   compare exact whole-file and selected-line hashes and abort on concurrent drift.
   Preserve every other task, running process, and durable job record.
2. Stage the verified artifact separately. Check its architecture/runtime, manifest,
   file ownership, secret-free build configuration and existing secure runtime env
   identity. Do not run a second worker against the production queue.
3. Before stopping the old service, review a narrow systemd drop-in:
   `TimeoutStopSec=180s` and `SendSIGKILL=no`. The original90second timeout can
   force-kill callbacks; never let that happen implicitly. The extended timeout
   allows the observed120second idle pool to retire naturally. If the service
   remains alive, stop the transition for an explicit operator decision.
4. Stop the old service gracefully and require its actual process exit. Empty HTTP
   connections or expired database leases do not establish detached-work drain.
   Preserve the jobs pause throughout. Switch the artifact only after exit, start
   with the existing secure environment, and verify exact manifest, listener and
   unauthenticated cron denial without issuing customer-work ticks.
5. Resume only the backed-up jobs entry after reviewed adoption evidence. Refuse
   changed scheduler hashes. Observe normal scheduled work with aggregate status
   evidence; never reset leases, cancel jobs or replay effects to manufacture green.

No automatic rollback to the unfenced historical worker is permitted. On failed
adoption, keep jobs paused, preserve evidence and the last reviewed safe artifact,
and request a bounded recovery decision. Lifecycle cleanup deliberately waits for
callbacks and graceful cache/database closes without `process.exit` or destructive
pool reset.

TODO(handoff): Full provider and authenticated tenant acceptance remain separate
from controlled worker tests; see meta proposal
`proposals/2026-09-12-hub-booking-stock-postcommit-recovery.md` and phase10-15.
