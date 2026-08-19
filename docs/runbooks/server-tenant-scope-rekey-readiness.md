# Runbook — server tenant-scope re-key readiness audit (PR #130, Slice 1)

**Status: BLOCKED — awaiting a credential holder.** No agent can clear this gate. The audit
command, its comparison rules and its wiring are checked in and covered by tests; what is missing
is the four evidence artifacts in [Evidence to record](#evidence-to-record), which can only be
produced by someone holding real non-production and production credentials.

The block is enforced, not merely documented: `scripts/rekey-readiness-gate.test.ts` reads the
shipped `updateServer` source, and the moment it carries a `servers.tenantId` predicate the suite
fails unless `tests/rekey-readiness/evidence.json` records both passing audits and the re-key
deployment. Slice 2 therefore cannot land ahead of its evidence by accident.

**Owner:** whoever holds the hub's Turso and Supabase service-role credentials.
**Spec:** `FACTORY_SPEC.md` (`specs/2026-08-18-hub-updateserver-tenant-scope-spec.md`), Slice 1
work items 3–4 and Definition of done.
**Command source:** `scripts/audit-server-tenant-scope.ts` (I/O) and
`scripts/audit-server-tenant-scope.lib.ts` (comparison rules).

## What this proves, and why Slice 2 waits on it

Slice 2 adds `eq(servers.tenantId, ctx.tenantId)` to `updateServer`'s WHERE clause. That predicate
is only safe if every live Turso `servers.tenant_id` is non-null and exactly equals one canonical
Supabase `organizations.id` — the value supplied as `TenantContext.tenantId`. If a live row still
carries a legacy key, the new predicate matches nothing and silently denies a legitimate
same-tenant update instead of denying a cross-tenant one.

The two databases are physically separate and cannot be joined in SQL, so the audit reads each side
separately and compares exact strings in memory. It issues `SELECT`s only, and never writes.

## Prerequisites

Read-only access is sufficient for both sources, in **each** environment you audit:

| Variable                    | Source                                             | Used for                            |
| --------------------------- | -------------------------------------------------- | ----------------------------------- |
| `TURSO_DB_URL`              | Turso database for that environment (`libsql://…`) | `SELECT id, tenant_id FROM servers` |
| `TURSO_DB_AUTH_TOKEN`       | Turso token for that database                      | authenticates the read              |
| `PUBLIC_SUPABASE_URL`       | Supabase project for that environment              | canonical organization ids          |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key for that project         | reads `organizations.id` past RLS   |

Confirm each pair points at the environment you intend before running. A hub environment has
historically had `SUPABASE_DB_URL` on localhost while `PUBLIC_SUPABASE_URL` pointed at prod
(`docs/2026-06-09-turso-cutover-B3-B5-execution.md`, Stage 0); a mismatched pair audits the wrong
project. The command reads no dotenv file (`bun --no-env-file`) and aborts if any of the four
variables is empty, so it cannot silently fall back to the local `file:./data/minion_hub.db`.

## Step 1 — non-production

```bash
TURSO_DB_URL=<nonprod libsql url> \
TURSO_DB_AUTH_TOKEN=<nonprod turso token> \
PUBLIC_SUPABASE_URL=<nonprod supabase url> \
SUPABASE_SERVICE_ROLE_KEY=<nonprod service role key> \
bun run audit:server-tenant-scope
```

## Step 2 — production

Same command, production credentials:

```bash
TURSO_DB_URL=<prod libsql url> \
TURSO_DB_AUTH_TOKEN=<prod turso token> \
PUBLIC_SUPABASE_URL=<prod supabase url> \
SUPABASE_SERVICE_ROLE_KEY=<prod service role key> \
bun run audit:server-tenant-scope
```

## Reading the result

A passing run exits 0 and prints:

```
turso_server_rows=<n> null_tenant_ids=0 unmatched_tenant_ids=0
[audit] PASS — every Turso servers.tenant_id matches a canonical Supabase organizations.id
```

`<n>` must be non-zero. The audit fails closed, so it also exits 1 on the degenerate cases where it
proves nothing:

| Output                                                    | Meaning                                                                        | Action                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| exit 0, non-zero `turso_server_rows`, both error counts 0 | readiness proven for that environment                                          | record the output; both environments must pass                       |
| `inspected 0 Turso servers rows`                          | empty or wrong database                                                        | fix the credentials and re-run; this is not a pass                   |
| `read 0 canonical Supabase organizations`                 | empty or wrong project                                                         | fix the credentials and re-run; this is not a pass                   |
| `null_tenant_ids` > 0                                     | rows never carried a tenant key                                                | park Slice 2; hand to data repair, which is out of this spec's scope |
| `unmatched_tenant_ids` > 0                                | rows still carry a pre-re-key key; the sampled `servers.id` values are printed | park Slice 2; the re-key is incomplete                               |
| `TURSO_DB_URL and TURSO_DB_AUTH_TOKEN must be set`        | a credential is missing                                                        | supply all four; do not let it fall through to a local file          |

Do not mutate either database to make the audit pass.

## Rollback and recovery

The audit itself needs no rollback: it opens read-only connections, issues `SELECT`s, closes the
libSQL client in a `finally`, and writes nothing to either source. Aborting it mid-run leaves no
partial state.

Recovery applies to the **re-key**, not to the audit. If either run reports non-zero counts, the
live data does not match what Slice 2 assumes: leave `updateServer` untouched, keep Slice 2 parked,
and route the mismatch to whoever owns the Turso→Supabase re-key. Attach that owner's rollback or
re-run record for the re-key deployment here once it exists. Slice 1 ships only tests and this
read-only command, so there is nothing in this branch to revert if the audit fails.

## Evidence to record

All four are required before Slice 1 is accepted and before any Slice 2 work starts. None of them
is present yet.

1. **Non-production run** — the exact command (credentials redacted) and its full output, showing a
   non-zero `turso_server_rows` with `null_tenant_ids=0 unmatched_tenant_ids=0`.
2. **Production run** — same, against production.
3. **Re-key record** — the concrete migration or deployment identifier that performed the
   Turso→Supabase `servers.tenant_id` re-key, plus evidence it was applied. A planning-spec status
   is not enough. The in-repo cutover documents
   (`docs/2026-06-05-turso-legacy-cutover-plan.md`, `docs/2026-06-09-turso-cutover-B3-B5-execution.md`)
   are plans, one of them superseded; neither is apply evidence.
4. **Rollback/recovery note for that re-key** — from its owner.

Record them in `tests/rekey-readiness/evidence.json` (create the file; it is deliberately absent
while the work is parked) and paste the same two outputs into the PR thread. The JSON is what the
gate checks; the PR paste is what a human reviewer reads.

```json
{
  "schemaVersion": 1,
  "runs": [
    {
      "environment": "non-production",
      "recordedAt": "<ISO 8601 timestamp of the run>",
      "recordedBy": "<who ran it>",
      "command": "bun run audit:server-tenant-scope",
      "tursoServerRows": 0,
      "nullTenantIds": 0,
      "unmatchedTenantIds": 0
    },
    {
      "environment": "production",
      "recordedAt": "<ISO 8601 timestamp of the run>",
      "recordedBy": "<who ran it>",
      "command": "bun run audit:server-tenant-scope",
      "tursoServerRows": 0,
      "nullTenantIds": 0,
      "unmatchedTenantIds": 0
    }
  ],
  "rekeyRecord": {
    "identifier": "<migration or deployment id that re-keyed servers.tenant_id>",
    "appliedAt": "<ISO 8601 timestamp it was applied>",
    "applyEvidence": "<link or reference proving it ran>",
    "rollbackNote": "<rollback/recovery procedure from the re-key owner>"
  }
}
```

Transcribe `tursoServerRows` from each run's real `turso_server_rows=<n>`; the gate rejects a zero,
for the same fail-closed reason the audit itself does. It also rejects an audit run for only one
environment, a non-zero mismatch counter, and an empty field in `rekeyRecord`.

PR paste template:

```text
### Slice 1 re-key readiness evidence

**Non-production** (`<environment name>`, `<date>`)
$ TURSO_DB_URL=<redacted> TURSO_DB_AUTH_TOKEN=<redacted> \
  PUBLIC_SUPABASE_URL=<redacted> SUPABASE_SERVICE_ROLE_KEY=<redacted> \
  bun run audit:server-tenant-scope
<paste full output>

**Production** (`<date>`)
$ <same command with production credentials, redacted>
<paste full output>

**Re-key record:** <migration or deployment identifier> — applied <date>, evidence: <link>
**Rollback/recovery note:** <link or text>
```

## What is already proven without credentials

So a reviewer does not have to re-derive it: `scripts/audit-server-tenant-scope.test.ts` covers the
comparison rules against fixtures (matching keys, several servers per tenant, null and empty-string
keys, legacy keys with sampling, the ten-id sample cap, and both fail-closed empty-source cases),
the paginated organization read at its page boundaries, and the command's refusal to start when a
credential is missing even with a repository dotenv file present. It also rehearses the whole
command end-to-end against local stand-ins, and covers the gate's own rules — that it stays quiet
while the predicate is parked, and reds on a missing environment, a zero-row run, a non-zero
mismatch counter, or an incomplete re-key record. That rehearsal exercises the wiring; it is **not**
evidence about any real environment and does not substitute for the two runs above.
