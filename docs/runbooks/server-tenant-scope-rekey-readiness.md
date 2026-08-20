# Runbook — server tenant-scope re-key readiness audit (PR #130, Slice 1)

**Status: BLOCKED — awaiting a credential holder.** No agent can clear this gate. The audit
command, its comparison rules and its wiring are checked in and covered by tests; what is missing
is the four evidence artifacts in [Evidence to record](#evidence-to-record), which can only be
produced by someone holding real non-production and production credentials.

Check the current state in one command — it needs no credentials and reads only a file:

```bash
bun run rekey:readiness      # exits 1 and lists every missing artifact while blocked
```

The block is enforced, not merely documented, from two directions:

- `bun run rekey:readiness` exits 1 until all four artifacts are recorded and passing. It asks the
  question unconditionally, so "nobody has done the human half yet" is a visible, non-zero exit
  rather than silence.
- The test suite binds the shipped mutation to the recorded evidence, in both directions.
  `src/server/services/server.service.test.ts` ("updateServer tenant scope") runs the real
  `updateServer` against a two-tenant table and reads the answer off the rows that actually moved:
  the moment the mutation stops writing across tenants, the suite fails unless
  `tests/rekey-readiness/evidence.json` records both passing audits and the re-key deployment — so
  Slice 2 cannot land ahead of its evidence by accident. The converse holds too: once the evidence
  is complete, the suite fails while `updateServer` still matches on `servers.id` alone, so
  recording the evidence cannot quietly leave the defect open. `scripts/rekey-readiness-gate.test.ts`
  applies the same rule to the service's source shape as defence in depth, and the two answers are
  pinned against each other. Gating on behaviour rather than on the source text is deliberate: a
  text search for `servers.tenantId` inside `updateServer` also matches a comment, a log line, an
  assignment into the `set` object, or a tenant-scoped _read_ above an unscoped UPDATE, and would
  certify all four as scoped.

Re-confirmed on 2026-08-20, after a review escalation asked for the evidence again:
`bun run rekey:readiness` still reports `rekey_readiness=BLOCKED missing=5`. The agent
environment this branch is developed in holds no `TURSO_DB_URL`, `TURSO_DB_AUTH_TOKEN`,
`PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` for any real environment, and the only value
it could fall back to is the local `file:./data/minion_hub.db` — which the command refuses on
purpose, because a pass against an empty local file would be a false answer to a security question.
Producing these four artifacts is therefore not work that was skipped; it is work that cannot be
done from here. What this branch does instead is make their absence loud and their arrival binding
(the two enforcement directions below), and leave Slice 2 parked with the cost of parking stated in
[Decision point for the human merge gate](#decision-point-for-the-human-merge-gate).

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
REKEY_RECORDED_BY="<your name>" \
bun run audit:server-tenant-scope -- --record non-production
```

`--record` writes the counters this run actually produced into
`tests/rekey-readiness/evidence.json`, and only on a PASS — it refuses to record a run the gate
would reject, so a written entry always means that environment passed. Drop the flag if you only
want to look. `REKEY_RECORDED_BY` is optional; without it the entry records the login name, which
on a shared operator box is not an accountable identity.

## Step 2 — production

Same command, production credentials:

```bash
TURSO_DB_URL=<prod libsql url> \
TURSO_DB_AUTH_TOKEN=<prod turso token> \
PUBLIC_SUPABASE_URL=<prod supabase url> \
SUPABASE_SERVICE_ROLE_KEY=<prod service role key> \
REKEY_RECORDED_BY="<your name>" \
bun run audit:server-tenant-scope -- --record production
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

Artifacts 1 and 2 are written for you by `--record` (Steps 1 and 2); artifacts 3 and 4 are typed in
by hand, because only the re-key's owner has them. The file lives at
`tests/rekey-readiness/evidence.json` and is deliberately absent while the work is parked — the
first `--record` run creates it, with a blank `rekeyRecord` showing what is still owed. Paste the
same two outputs into the PR thread as well: the JSON is what the gate checks, the PR paste is what
a human reviewer reads.

After filling in `rekeyRecord`, confirm with:

```bash
bun run rekey:readiness      # exits 0 and prints rekey_readiness=READY missing=0 when complete
```

The finished file looks like this:

```json
{
  "schemaVersion": 1,
  "runs": [
    {
      "environment": "non-production",
      "recordedAt": "<ISO 8601 timestamp of the run>",
      "recordedBy": "<who ran it>",
      "command": "bun run audit:server-tenant-scope -- --record non-production",
      "tursoServerRows": 0,
      "nullTenantIds": 0,
      "unmatchedTenantIds": 0
    },
    {
      "environment": "production",
      "recordedAt": "<ISO 8601 timestamp of the run>",
      "recordedBy": "<who ran it>",
      "command": "bun run audit:server-tenant-scope -- --record production",
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

`tursoServerRows` is copied from the run's real `turso_server_rows=<n>` by `--record`. Hand-editing
it is possible but pointless: the gate rejects a zero, for the same fail-closed reason the audit
itself does, and also rejects an audit run for only one environment, a non-zero mismatch counter,
and an empty field in `rekeyRecord`.

PR paste template:

```text
### Slice 1 re-key readiness evidence

**Non-production** (`<environment name>`, `<date>`)
$ TURSO_DB_URL=<redacted> TURSO_DB_AUTH_TOKEN=<redacted> \
  PUBLIC_SUPABASE_URL=<redacted> SUPABASE_SERVICE_ROLE_KEY=<redacted> \
  bun run audit:server-tenant-scope -- --record non-production
<paste full output>

**Production** (`<date>`)
$ <same command with production credentials, redacted>
<paste full output>

**Re-key record:** <migration or deployment identifier> — applied <date>, evidence: <link>
**Rollback/recovery note:** <link or text>
```

## Decision point for the human merge gate

Slice 1 cannot be closed by any agent, so the call belongs to a human. Both options have a cost,
and the cheaper-looking one is not free — that is what this section exists to say out loud.

**Option A — keep Slice 2 parked until the evidence exists (what this branch implements).**
Fail-closed with respect to the _data_: no predicate is added while it is unknown whether a live
row would be silently denied by it. The cost is that the defect Slice 2 closes stays open in
production for as long as the evidence takes. That defect is real and pinned by a test
(`src/server/services/server.service.test.ts`, "updateServer tenant scope"): `updateServer` matches on
`servers.id` alone, and `assertOwnsOrAdmin()` in `src/routes/api/servers/[id]/+server.ts` returns
true for **any** admin, so an admin of one organization who supplies another organization's server
id patches that row — name, url, gateway token — and receives `ok`. Parking is a decision to accept
that exposure for the duration, not a neutral hold.

**Option B — ship the predicate now, before the evidence.** Fail-closed with respect to
_authorization_, at the risk the spec parked it for: if any live row still carries a pre-re-key
tenant key, its legitimate owner's updates start no-op'ing silently. The branch does not take this
option, for two reasons. The spec makes the audit a prerequisite of the predicate, not advice; and
a slice whose prerequisite gate is unmet is not the place to override that gate — that is the
human's call to make explicitly, with the residual risk in [What is already proven without
credentials](#what-is-already-proven-without-credentials) in front of them.

If the decision is Option B, say so on the PR and record it in the evidence file's history: the
gate will red until `tests/rekey-readiness/evidence.json` is complete, and it should — an override
ought to be visible, not silent.

## What is already proven without credentials

**About the live risk.** `src/server/services/server.service.test.ts` runs the shipped service
against an in-memory `servers` table that really applies the predicates the service builds, and
shows that `listServers` (both the admin branch and the `user_servers`-linked branch),
`getServerToken` and `deleteServer` **already** require `servers.tenantId === ctx.tenantId`. So a
row carrying a pre-re-key key is, today, already unlistable, untokenable and undeletable for its
tenant: the equality Slice 2 would add to `updateServer` is load-bearing on every other server read
path in the file. Two honest limits on that: it bounds the _consequence_ of a mismatch, it does not
show that no mismatched row exists — only the two real runs above can — and `assertOwnsOrAdmin()`
can authorize a server id that did not come from `listServers` (it also consults Supabase
`user_gateway` and the Turso `user_servers` link), so "unreachable through the hub's own reads" is
not the same as "unreachable".

**About the tooling.** So a reviewer does not have to re-derive it:
`scripts/audit-server-tenant-scope.test.ts` covers the
comparison rules against fixtures (matching keys, several servers per tenant, null and empty-string
keys, legacy keys with sampling, the ten-id sample cap, and both fail-closed empty-source cases),
the paginated organization read at its page boundaries, and the command's refusal to start when a
credential is missing even with a repository dotenv file present. It also rehearses the whole
command end-to-end against local stand-ins, and covers the gate's own rules — that it stays quiet
while the predicate is parked, that it reds on a missing environment, a zero-row run, a non-zero
mismatch counter, or an incomplete re-key record, and that it reds on complete evidence shipped
with an unscoped mutation. The source-shape guard carries its own false-positive regressions: a
comment naming the predicate, a string literal or log line, an assignment into the `set` object, a
tenant-scoped read above an unscoped UPDATE, another table's scoped update, an UPDATE with no
`where` at all, a `where` applied through a separate binding, and a body where only one of two
`update(servers)` chains is scoped — every one of them answers "not scoped". It also covers
`--record` (it writes the counters a real run produced, refuses an unknown environment name,
refuses a run the gate would reject, and preserves the other environment's entry and any
hand-written `rekeyRecord`) and both exit codes of `bun run rekey:readiness`. That rehearsal
exercises the wiring; it is **not** evidence about any real environment and does not substitute for
the two runs above.
