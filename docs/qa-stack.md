# Hub local QA stack

A private, time-boxed copy of the Hub — real Supabase auth, real Postgres on
the production schema, fully seeded — for testing UI features and database
interactions without touching production. Spec:
`specs/2026-09-16-hub-local-qa-stack-spec.md`.

## Prerequisites

- Docker (the current user must be in the `docker` group, or run these
  scripts with equivalent access).
- `bun` installed on the host (the QA app runs _inside_ a container, but the
  lifecycle scripts run on the host with `bun scripts/qa/*.ts`).
- Network access to run `npx --yes supabase@2.101.0 …` (pinned CLI version).
- A committed baseline at `supabase/qa/baseline/` (owner-run via
  `bun run qa:snapshot --confirm-prod-read`; see spec §3).
- Enough free RAM for the lean Supabase set (~1 GB) plus the app dev server
  (~1.5 GB, capped by `NODE_OPTIONS=--max-old-space-size=2048`). Check `free
-h` before starting — on a tight host, stop other containers first.

## Commands

| Command                                          | Does                                                                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `bun run qa:up [--ttl 2h] [--no-seed] [--fresh]` | Starts (or reuses) Supabase, bootstraps the DB, seeds, writes `.env.qa`, starts the app container, arms the TTL.              |
| `bun run qa:down [--volumes]`                    | Disarms the TTL, stops the app container and Supabase. Keeps data volumes unless `--volumes`.                                 |
| `bun run qa:reset`                               | Drops and recreates the `public` schema, re-bootstraps and re-seeds in place. Use after pulling a branch with new migrations. |
| `bun run qa:status`                              | Containers, pending-migration count, TTL remaining, app health probe.                                                         |
| `bun run qa:extend [--ttl 1h]`                   | Re-arms the TTL from now (default 2h).                                                                                        |
| `bun run qa:env`                                 | Regenerates `.env.qa` from the running Supabase stack (`qa:up` calls this automatically).                                     |

## Ports

Offset from the meta-repo's own local stack (54321–54324) so both can run at
once:

| Service                                       | Port              |
| --------------------------------------------- | ----------------- |
| Supabase API (GoTrue/PostgREST/Kong)          | `127.0.0.1:54421` |
| Postgres                                      | `127.0.0.1:54422` |
| Hub app (vite dev, in the `hub-qa` container) | `127.0.0.1:5199`  |

## Personas

`scripts/qa/seed/env.ts` writes `.env.qa.local` (mode `600`, gitignored):
`QA_<PERSONA>_EMAIL` / `QA_<PERSONA>_PASSWORD` pairs for every
`tenancy.user.*` seed fixture, plus `E2E_OWNER_*` / `E2E_MANAGER_*` /
`E2E_MEMBER_*` / `E2E_RESTRICTED_*` aliases that `tests/e2e/ui-audit/personas.ts`
already reads. `qa:up` prints this table after it finishes; `cat .env.qa.local`
any time after a seed run.

## Never-prod guards

- `scripts/qa/qa-database-guard.ts` refuses any Postgres URL that isn't
  loopback on the QA stack's fixed port (54422) unless `--allow-port` is
  passed deliberately.
- `qa:up` additionally refuses to start if `SUPABASE_DB_URL` or
  `PUBLIC_SUPABASE_URL` is already set in the shell to a non-loopback host —
  a stale exported var from a different project must never leak into this
  pipeline.
- The Supabase project id `minion-hub-qa` is local-only. **Never run
  `supabase link` or `supabase config push`/`db push` against it.**
- Never run these scripts with a `.env.local` that points at production —
  that file is for `qa:snapshot` only, and `qa:snapshot` itself opens a
  read-only transaction.

## The pairing rule (spec §6)

Any PR touching `supabase/migrations/*.sql` must also touch
`scripts/qa/seed/**` or `supabase/qa/baseline/**`, or carry the
`seed-unaffected` label with a one-line reason in the PR body. Enforced in CI
by `scripts/qa/check-migration-seed-pairing.ts` (S4). If your migration adds
a table or column that QA fixtures should exercise, add the corresponding
`scripts/qa/seed/matrix.ts` entries in the same PR.

## Networking: why `network_mode: host`

The app container (`docker-compose.qa.yml`) runs with `network_mode: host`
instead of joining the Supabase project's Docker network. Both Supabase
clients in this codebase —
[`src/lib/supabase/client.ts`](../src/lib/supabase/client.ts) (browser) and
[`src/server/supabase.ts`](../src/server/supabase.ts) (server) — read the
same `PUBLIC_SUPABASE_URL`; there is no server-only URL variable to point at
an in-network Kong hostname. Host networking makes the container see
`127.0.0.1:54421`/`54422` exactly as the browser and the CLI do, so one URL
works everywhere with no code change. This is Linux-only (matches the host
this spec targets); it will not behave the same under Docker Desktop on
macOS/Windows.

## Troubleshooting

- **Memory watchdog / OOM**: the app container is capped at `mem_limit: 3g`
  with `NODE_OPTIONS=--max-old-space-size=2048`. If the host is tight on RAM,
  stop other containers or `qa:down` other QA stacks before `qa:up`.
- **Port clash with the meta stack (54321-54324)**: this stack uses
  54421/54422/5199 specifically to avoid it. If you still see a clash, check
  for a leftover `supabase_*_minion-hub-qa` container: `docker ps -a | grep
minion-hub-qa`.
- **Stale volumes / weird migration state**: `bun run qa:up --fresh` stops
  the stack and drops volumes before starting clean.
- **`qa:up` hangs on `docker compose up -d --wait`**: the healthcheck hits
  `http://127.0.0.1:5199/en/login`; check container logs with `docker compose
-f docker-compose.qa.yml logs -f hub` — a common cause is Supabase not yet
  healthy when the app tries its first request.
- **TTL didn't fire**: `bun run qa:status` shows which lane armed it
  (`systemd` or `fallback`). On a host without a user systemd instance the
  fallback is a detached `sleep`, tracked in `.qa/ttl.pid` /
  `.qa/ttl.deadline` — check the PID is still alive with `ps -p $(cat
.qa/ttl.pid)`.
- **Decryption errors on rows sealed with `ENCRYPTION_KEY`**: `qa:env`
  persists the key at `.qa/encryption-key` and reuses it on every re-run so
  previously seeded encrypted rows stay readable across `qa:up`/`qa:reset`.
  Delete that file (and re-seed) only if you intend to invalidate old sealed
  rows.
