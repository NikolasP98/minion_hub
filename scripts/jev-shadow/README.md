# FACES JEV shadow pilot

An isolated seven-day observer on Netcup. It does not depend on or deploy the uncommitted Hub tagging foundation. The source role can execute two fixed FACES-only read functions and cannot select CRM tables directly or mutate memberships. There is no code path that applies tags, changes scores, or sends messages.

Requests use `~typesafe/jev-latest` and a frozen copy of candidate-v2 starter descriptions. Settings changes are **not** live-synced during this experiment: preserving the frozen rubric makes the week interpretable. The CRM configuration UI remains a separate unreleased change.

## Admission

Default deployment is readiness-only (`empiricalPilotAuthorized: false`). The production tagging adapter remains blocked. The shadow service can call JEV only after explicit authorization of a smaller empirical pilot. This is not a provider-certified tokenizer or output-cap guarantee. Official API contract: https://docs.typesafe.ai/api ; model limits: https://docs.typesafe.ai/models .

Pilot limits: 12,000 serialized UTF-8 request bytes; up to eight typed noul questions; at most 6,000 bytes of complete messages; max 2,000 bytes per message; at most 25 messages from the last 30 days in SQL. Inputs omit oversized messages and mark coverage incomplete. SQL never returns an unlimited conversation. Email/phone-like identifiers are redacted; free text is still customer data, not claimed anonymous.

Reported usage above 30,000 input or 2,000 output tokens halts the experiment and quarantines the attempt. Missing costs, transport/parse errors, malformed answers, model-version drift, and cost above the reservation also halt it. No automatic provider retry; an uncertain attempt keeps its reservation. An operator must inspect receipts before clearing a halt.

Each call reserves USD 0.01 durably before network dispatch. Limits: 100 attempts/day UTC, USD 1/day accounted exposure, USD 5 total accounted exposure, ten calls/tick. Provider outages can consume a reservation; known costs replace reservations. These are application admission caps, not a provider billing guarantee. No customer-visible writes occur under any model outcome.

## Operations

- `minion-jev-shadow.timer`: every 15 minutes, one local `flock` owner. Pages 50 contacts by UUID to avoid repeatedly selecting only the most active contacts. Source reads have a five-second timeout.
- `minion-jev-shadow-monitor.timer`: independent quarter-hour heartbeat/report refresh, separate from the worker and without API/DB secrets.
- `minion-jev-shadow-backup.timer`: daily private SQLite snapshot. Same-host backup protects against accidental database damage, **not host loss**.
- Private evidence: `/var/lib/minion-jev-shadow/ledger.sqlite`, `report.json`, daily backups. Service user owns the directory; mode0700 directory/mode0600 files. No public endpoint.
- `sudo systemctl status minion-jev-shadow.timer minion-jev-shadow-monitor.timer`
- `sudo cat /var/lib/minion-jev-shadow/report.json` gives usage, failures, model versions, latency, decision buckets, review due date and sparse expected-versus-observed matrices.
- `sudo journalctl -u minion-jev-shadow.service --since '24 hours ago'` contains counts and error codes, not conversation bodies.
- Pause: `sudo systemctl stop minion-jev-shadow.timer`; wait for the current oneshot to finish. Disabling `enabled` in the config additionally prevents manual service starts from calling the provider.

SQLite uses WAL, FULL synchronization, pre-call reservations and startup recovery. A crash during a provider attempt becomes `unknown` and halts admission instead of replaying a potentially billed call. Private context/request/receipt bodies and daily backups are purged after 30 days; aggregate metrics and human label events remain.

## Week review

The seven-day deadline is persisted from deployment, not reset by restarts. After it expires, the worker stops evaluation automatically; the independent report marks `week_review_due`. This schedules evidence generation, **not an unattended agent conversation or an external notification**.

Review operational errors first: missing ticks, source timeouts, unknown spend, model drift, coverage omissions, and latency/cost. Draw a stratified human-review sample from high/medium predictions, abstentions and low-score results for every tag. Reviewers read the frozen private snapshot before labeling; model probabilities are not ground truth. Store labels with `worker.mjs label RUN_ID TAG positive|negative|unknown REVIEWER` as the service user. The report updates expected-versus-observed counts. The broader offline confusion-matrix evaluator remains in meta `audits/2026-09-21-jev-crm-tags/qualification/`.

Use this week for development and bug fixes, not held-out certification. Do not claim precision/recall from unlabeled predictions or promote thresholds automatically. Every fix needs a regression case and a new source/rubric revision; keep old evidence immutable and use a later independent holdout for qualification.

## Validation and lifecycle

Run `node --test shadow.test.mjs` and `JEV_TEST_DATABASE_URL=<fresh local minion_qc_jev_* URL> node --test source.test.mjs`. The source fixture creates its own tables and refuses production URLs. The actual provider probe uses synthetic text only and reports observed usage; it cannot establish the missing tokenizer guarantee.

This isolated experiment is explicitly requested for PRD. Deployment uses its own content-hashed artifact, service user, credentials and timers. It does not merge or deploy the shared Hub checkout. The normal Hub application merge/release is deferred; this exception is limited to the shadow observer and is recorded in the meta proposal. No other production worker or scheduler is stopped or replaced.

TODO(handoff): Integrate reviewed shadow outcomes, configurable rubric revisions, policy calibration, authenticated UI and off-host backup/erasure propagation into the full CRM layer. Keep live application disabled until qualification. See meta proposal `2026-09-21-hub-configurable-jev-crm-tags.md`.
