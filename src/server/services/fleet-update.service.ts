/**
 * Fleet update orchestrator (spec `specs/2026-07-11-fleet-update-orchestration.md` §3.2).
 *
 * Step-wise state machine, client-advanced — no long-running function (Vercel
 * 300s ceiling), no new infra. State lives in the existing `bg_jobs` table
 * (type `fleet_update`), one row per tenant's in-flight rollout: `cursor`
 * holds `{ targetVersion, instances, currentIndex }` as JSON.
 *
 * ponytail: this does NOT go through bg-runtime's `advanceJob`/
 * `registerJobHandler` — that machine loops handler.advance() until a time
 * budget is spent (built for cron ticks doing several cheap rounds per tick).
 * A fleet-update step is a single drain+run+poll cycle that can alone take up
 * to ~243s, and the spec requires "advance = exactly ONE instance step" so
 * the client can abort between instances — looping-until-budget would blur
 * that boundary. Reading/writing `bg_jobs` directly is the smaller, correct
 * fit; only the table (not the generic runner) is reused.
 *
 * ponytail: no distributed lease/claim — single admin driving this from one
 * open tab is the expected usage (mirrors the single-admin assumption of the
 * existing per-instance update card). Add a lease column the way
 * bg-runtime.ts does if concurrent-admin races become a real problem.
 */

import { and, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getCoreDb } from '$server/db/pg-client';
import { bgJobs } from '$server/db/pg-schema/bg-jobs';
import { listGatewaysForAdmin, getGatewayCredentialsById } from './gateway.pg.service';
import { gatewayCallToInstance } from '$lib/server/gateway-rpc';

const JOB_TYPE = 'fleet_update';
const ACTIVE_STATUSES = ['queued', 'running'] as const;
const POLL_INTERVAL_MS = 5000;
const VERIFY_TIMEOUT_MS = 240_000;

export type FleetInstanceState =
  | 'pending'
  | 'draining'
  | 'updating'
  | 'verifying'
  | 'done'
  | 'failed';

export interface FleetInstance {
  gatewayId: string;
  name: string;
  url: string;
  state: FleetInstanceState;
  /** null = unknown — gateway predates `connections` reporting, or was
   * unreachable at snapshot time. UI renders "—", never "0 connections". */
  connections: number | null;
  fromVersion: string | null;
  toVersion: string;
  error?: string;
  /** false once this instance's `update.run` was retried without `drain`
   * because the running build predates drain support (round-4 fix 1). */
  drainSupported?: boolean;
  /** True progress relayed from the gateway's `update.progress` broadcasts,
   * observed on the orchestrator's own WS during `update.run` and persisted
   * here so the UI can render bars from job polling — independent of whether
   * the browser's own gateway connection survives the restart (round-6). */
  progressPct?: number | null;
  progressPhase?: string | null;
}

interface FleetCursor {
  targetVersion: string;
  instances: FleetInstance[];
  currentIndex: number;
}

export type FleetJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface FleetJobView {
  id: string;
  targetVersion: string;
  instances: FleetInstance[];
  currentIndex: number;
  status: FleetJobStatus;
  error: string | null;
  startedBy: string | null;
  active: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Monotonic order key for a build version. Versions end in a 14-digit build
 * timestamp (`2026.7.11-dev.20260711212523`) that is strictly increasing and
 * zero-padded — safe to compare numerically. Lexicographic compare of the
 * whole string is NOT safe (minor `2026.7.9` vs `2026.7.10` breaks). Returns
 * NaN when no timestamp suffix is present (e.g. a bare `dev` channel tag).
 */
function versionOrder(version: string | null | undefined): number {
  if (!version) return NaN;
  const m = version.match(/(\d{14})\s*$/);
  return m ? Number(m[1]) : NaN;
}

/** An instance is "at or past" a target when it exactly matches it, or (when
 * both parse) its build is >= the target's — the fleet only ever rolls
 * FORWARD, so an instance already on a newer build is done, never a downgrade
 * candidate. Without a comparable suffix, falls back to exact-match. */
function isAtOrPast(current: string | null | undefined, target: string): boolean {
  if (current === target) return true;
  const c = versionOrder(current);
  const t = versionOrder(target);
  return !Number.isNaN(c) && !Number.isNaN(t) && c >= t;
}

/**
 * A terminal FAILED fleet job is "superseded" once every reachable instance
 * has moved to a build at or beyond the job's (failed) target — the fleet
 * rolled forward past it, so the lingering "did not reach X" record is a
 * phantom. Distinguishes supersession (instances NEWER than target) from a
 * failed rollback (instances OLDER than target, still worth showing). Ignores
 * unreachable instances; needs at least one live confirmation to retire.
 */
async function isFailedJobSuperseded(row: typeof bgJobs.$inferSelect): Promise<boolean> {
  const cursor = JSON.parse(row.cursor ?? '{}') as Partial<FleetCursor>;
  const target = cursor.targetVersion;
  const instances = cursor.instances ?? [];
  if (!target || Number.isNaN(versionOrder(target)) || instances.length === 0) return false;

  let confirmed = false;
  for (const inst of instances) {
    const creds = await getGatewayCredentialsById(inst.gatewayId);
    if (!creds) continue;
    let current: string | undefined;
    try {
      const status = await gatewayCallToInstance<{ current?: string }>(
        creds.url,
        creds.token,
        'update.status',
        {},
        { timeoutMs: 8000 },
      );
      current = status.current;
    } catch {
      continue; // unreachable — can't judge this instance
    }
    // Any instance still on/behind the target means the record isn't a phantom.
    if (!isAtOrPast(current, target)) return false;
    confirmed = true;
  }
  return confirmed;
}

function toView(row: typeof bgJobs.$inferSelect): FleetJobView {
  const cursor = JSON.parse(row.cursor ?? '{}') as Partial<FleetCursor>;
  return {
    id: row.id,
    targetVersion: cursor.targetVersion ?? '',
    instances: cursor.instances ?? [],
    currentIndex: cursor.currentIndex ?? 0,
    status: row.status as FleetJobStatus,
    error: row.error ?? null,
    startedBy: row.userId ?? null,
    active: row.status === 'queued' || row.status === 'running',
  };
}

async function getActiveJobRow(tenantId: string) {
  const [row] = await getCoreDb()
    .select()
    .from(bgJobs)
    .where(
      and(eq(bgJobs.tenantId, tenantId), eq(bgJobs.type, JOB_TYPE), inArray(bgJobs.status, [...ACTIVE_STATUSES])),
    )
    .orderBy(desc(bgJobs.createdAt))
    .limit(1);
  return row ?? null;
}

async function getLatestJobRow(tenantId: string) {
  const [row] = await getCoreDb()
    .select()
    .from(bgJobs)
    .where(and(eq(bgJobs.tenantId, tenantId), eq(bgJobs.type, JOB_TYPE)))
    .orderBy(desc(bgJobs.createdAt))
    .limit(1);
  return row ?? null;
}

async function persist(
  jobId: string,
  cursor: FleetCursor,
  patch: { status?: FleetJobStatus; error?: string | null; finishedAt?: number | null } = {},
): Promise<void> {
  await getCoreDb()
    .update(bgJobs)
    .set({
      cursor: JSON.stringify(cursor),
      updatedAt: Date.now(),
      ...patch,
    })
    .where(eq(bgJobs.id, jobId));
}

/**
 * Snapshot the fleet from the `gateway` rows, order least-connections-first
 * (ties by created_at — canary = first), persist a new job. Refuses if a
 * fleet job is already active for this tenant.
 */
export async function startFleetUpdate(
  tenantId: string,
  userId: string | null,
  targetVersion: string,
): Promise<FleetJobView> {
  if (!targetVersion) throw new Error('targetVersion is required');
  if (await getActiveJobRow(tenantId)) throw new Error('A fleet update is already in progress');

  const rows = await listGatewaysForAdmin();
  const snapshot = await Promise.all(
    rows.map(async (row) => {
      const creds = await getGatewayCredentialsById(row.id);
      if (!creds) {
        return {
          gatewayId: row.id,
          name: row.name,
          url: row.url,
          current: null as string | null,
          // Unreachable at snapshot time — connections truly unknown.
          connections: null as number | null,
          // ponytail: no usable token — can't even reach it. Sort last
          // (most conservative) rather than silently skipping it out of the
          // plan; unrelated to the "old gateway omits the field" case below.
          sortConnections: Number.POSITIVE_INFINITY,
          createdAt: row.createdAt,
        };
      }
      try {
        const status = await gatewayCallToInstance<{ current?: string; connections?: number }>(
          creds.url,
          creds.token,
          'update.status',
          {},
          { timeoutMs: 8000 },
        );
        const known = typeof status.connections === 'number';
        return {
          gatewayId: row.id,
          name: row.name,
          url: row.url,
          current: status.current ?? null,
          // Defensive: gateways not yet running the §3.1 change omit
          // `connections` entirely — unknown, not zero (round-4 fix 2).
          connections: known ? (status.connections as number) : null,
          // Sort key only: treat "reachable but doesn't report" as
          // least-loaded so it isn't pushed to the back of the rollout.
          sortConnections: known ? (status.connections as number) : 0,
          createdAt: row.createdAt,
        };
      } catch {
        // Unreachable at snapshot time — same conservative fallback as above.
        return {
          gatewayId: row.id,
          name: row.name,
          url: row.url,
          current: null as string | null,
          connections: null as number | null,
          sortConnections: Number.POSITIVE_INFINITY,
          createdAt: row.createdAt,
        };
      }
    }),
  );

  snapshot.sort((a, b) => {
    if (a.sortConnections !== b.sortConnections) return a.sortConnections - b.sortConnections;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  const instances: FleetInstance[] = snapshot.map((s) => ({
    gatewayId: s.gatewayId,
    name: s.name,
    url: s.url,
    // At-or-past target = done. The fleet only rolls forward: an instance
    // already on a newer build must NOT be treated as pending (it would try to
    // "reach" an older target it never will, then time out — the stale-target
    // downgrade trap that produced the phantom "did not reach …050417" jobs).
    state: isAtOrPast(s.current, targetVersion) ? 'done' : 'pending',
    connections: s.connections,
    fromVersion: s.current,
    toVersion: targetVersion,
  }));

  let currentIndex = instances.findIndex((i) => i.state !== 'done');
  if (currentIndex === -1) currentIndex = instances.length;
  const status: FleetJobStatus = currentIndex >= instances.length ? 'done' : 'running';

  const id = randomUUID();
  const now = Date.now();
  await getCoreDb()
    .insert(bgJobs)
    .values({
      id,
      tenantId,
      userId,
      type: JOB_TYPE,
      refId: null,
      status,
      cursor: JSON.stringify({ targetVersion, instances, currentIndex } satisfies FleetCursor),
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      finishedAt: status === 'done' ? now : null,
    });

  const [row] = await getCoreDb().select().from(bgJobs).where(eq(bgJobs.id, id)).limit(1);
  return toView(row!);
}

/** Read the active (or most recent) fleet job for this tenant. Null = never started. */
export async function getFleetUpdateStatus(tenantId: string): Promise<FleetJobView | null> {
  const active = await getActiveJobRow(tenantId);
  if (active) return toView(active);

  const latest = await getLatestJobRow(tenantId);
  if (!latest) return null;

  // getLatestJobRow is unconditional, so a terminal FAILED rollout lingers as
  // the card's phantom forever (the card resurrects any active|failed job on
  // mount, and Retry re-runs its stale target). Once the fleet has rolled
  // forward past that target, retire the job (→ cancelled, which the card
  // ignores) so it stops resurfacing. One-time reconcile: after the flip the
  // row is no longer 'failed', so this RPC path is skipped on later reads.
  if (latest.status === 'failed' && (await isFailedJobSuperseded(latest))) {
    await getCoreDb()
      .update(bgJobs)
      .set({ status: 'cancelled', updatedAt: Date.now() })
      .where(eq(bgJobs.id, latest.id));
    return { ...toView(latest), status: 'cancelled', active: false };
  }

  return toView(latest);
}

/** Abort before the next instance. An in-flight instance finishes its own watchdog-guarded update. */
export async function abortFleetUpdate(tenantId: string): Promise<FleetJobView | null> {
  const row = await getActiveJobRow(tenantId);
  if (!row) return null;
  await getCoreDb()
    .update(bgJobs)
    .set({ status: 'cancelled', updatedAt: Date.now(), finishedAt: Date.now() })
    .where(eq(bgJobs.id, row.id));
  const [fresh] = await getCoreDb().select().from(bgJobs).where(eq(bgJobs.id, row.id)).limit(1);
  return toView(fresh!);
}

/** True when `update.run` was rejected specifically because the running
 * gateway build predates the `drain` param (mixed-fleet, round-4 fix 1) —
 * any other INVALID_REQUEST (or other error) still fails the step. */
function isDrainUnsupported(message: string): boolean {
  return message.includes('INVALID_REQUEST') && message.includes('drain');
}

/**
 * True when `gatewayCallToInstance` failed with an EXPLICIT application-level
 * rejection — the gateway was reached and definitively said no (bad auth,
 * invalid params, an error field on the response) — as opposed to a
 * connection-level failure (WS handshake 5xx, ECONNREFUSED/ECONNRESET,
 * timeout) where we genuinely don't know whether the gateway received the
 * request. `gateway-rpc.ts`'s `gatewayCallWithCreds` only ever includes the
 * substring "failed:" for its two explicit-response paths (`gateway connect
 * failed: …` and `` gateway ${method} failed: … ``); every transport-level
 * throw (raw `ws` errors, WS-closed, RPC timeout) uses different wording.
 * Round-5 fix: a restarting gateway behind the Tailscale funnel proxy
 * legitimately 502s at the WS handshake mid-restart — that must NOT read as
 * an explicit rejection.
 */
function isExplicitErrorResponse(message: string): boolean {
  return message.includes('failed:');
}

/**
 * Execute exactly ONE step of the current instance: drain+run (with
 * `drain.graceMs`), then poll-verify up to ~240s tolerating unreachability
 * during the restart. Per-instance failure STOPS the rollout.
 *
 * Permanent mixed-fleet behavior: if the instance rejects `drain` as an
 * unknown param (it predates drain support), retry the identical call
 * without it instead of failing — the instance still updates, just without
 * the graceful drain step.
 *
 * Round-5: any connection-level failure of the `update.run` call itself
 * (dropped mid-flight, WS handshake 5xx, timeout) is dispatch-uncertain, not
 * a failure — the install may well have been dispatched and be proceeding.
 * Only an explicit application-level rejection fails immediately; everything
 * else falls through to poll-verify, which decides on the version actually
 * reached (same accepted-semantics as the single-instance `/api/gateway/update`
 * route, broadened here because the fleet flow has a verify step to fall
 * back on).
 */
async function runInstanceStep(
  inst: FleetInstance,
  token: string,
  persistNow: () => Promise<void>,
): Promise<{ ok: true; drainSupported: boolean } | { ok: false; error: string }> {
  let drainSupported = true;

  // Relay the gateway's update.progress broadcasts (received on this very WS
  // while update.run is in flight) into the job row so the UI's job polling
  // shows true per-instance progress. Fire-and-forget persistence: events are
  // seconds apart and last-write-wins is fine.
  const onEvent = (event: string, payload: unknown) => {
    if (event !== 'update.progress') return;
    const p = payload as { phase?: string; pct?: number } | null;
    if (!p || typeof p.pct !== 'number') return;
    inst.state = 'updating';
    inst.progressPct = p.pct;
    inst.progressPhase = typeof p.phase === 'string' ? p.phase : null;
    void persistNow().catch(() => {});
  };

  inst.state = 'draining';
  inst.progressPct = 0;
  inst.progressPhase = 'draining';
  await persistNow().catch(() => {});

  try {
    await gatewayCallToInstance(
      inst.url,
      token,
      'update.run',
      { restartDelayMs: 2000, timeoutMs: 300_000, drain: { graceMs: 3000 } },
      { timeoutMs: 290_000, onEvent },
    );
  } catch (err) {
    const msg = String((err as Error)?.message ?? err);
    if (isDrainUnsupported(msg)) {
      drainSupported = false;
      try {
        await gatewayCallToInstance(
          inst.url,
          token,
          'update.run',
          { restartDelayMs: 2000, timeoutMs: 300_000 },
          { timeoutMs: 290_000, onEvent },
        );
      } catch (retryErr) {
        const retryMsg = String((retryErr as Error)?.message ?? retryErr);
        if (isExplicitErrorResponse(retryMsg)) return { ok: false, error: retryMsg };
        // else: connection-level — fall through to poll-verify.
      }
    } else if (isExplicitErrorResponse(msg)) {
      return { ok: false, error: msg };
    }
    // else: connection-level failure after dispatch — fall through to poll-verify.
  }

  inst.state = 'verifying';
  // The connection drop that lands us here IS the restart in the common case.
  if ((inst.progressPct ?? 0) < 90) {
    inst.progressPct = 90;
    inst.progressPhase = 'restarting';
  }
  await persistNow().catch(() => {});

  const deadline = Date.now() + VERIFY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    try {
      const status = await gatewayCallToInstance<{ current?: string }>(
        inst.url,
        token,
        'update.status',
        {},
        { timeoutMs: 8000 },
      );
      // Reconcile-to-truth: version match wins regardless of anything that
      // happened earlier in this step.
      if (status.current === inst.toVersion) return { ok: true, drainSupported };
    } catch (err) {
      const msg = String((err as Error)?.message ?? err);
      // An explicit rejection (e.g. bad/expired token) is reachable-but-wrong
      // — fail now rather than burn the full budget. A connection-level
      // failure (unreachable mid-restart, WS handshake 5xx) is expected —
      // keep polling.
      if (isExplicitErrorResponse(msg)) return { ok: false, error: msg };
    }
  }
  return { ok: false, error: `did not reach ${inst.toVersion} within ${VERIFY_TIMEOUT_MS / 1000}s` };
}

/**
 * Advance the active job by exactly one instance step. No-op (returns the
 * current view) if there is no active job — covers a stale/duplicate call
 * after the job already finished, failed, or was aborted.
 */
export async function advanceFleetUpdate(tenantId: string): Promise<FleetJobView | null> {
  const row = await getActiveJobRow(tenantId);
  if (!row) return getFleetUpdateStatus(tenantId);

  const cursor = JSON.parse(row.cursor ?? '{}') as FleetCursor;
  // Skip any instances already on target (bookkeeping only — no RPC calls).
  while (cursor.currentIndex < cursor.instances.length && cursor.instances[cursor.currentIndex].state === 'done') {
    cursor.currentIndex += 1;
  }
  if (cursor.currentIndex >= cursor.instances.length) {
    await persist(row.id, cursor, { status: 'done', finishedAt: Date.now() });
    return getFleetUpdateStatus(tenantId);
  }

  const inst = cursor.instances[cursor.currentIndex];
  const creds = await getGatewayCredentialsById(inst.gatewayId);
  if (!creds) {
    inst.state = 'failed';
    inst.error = 'gateway credentials not found';
    await persist(row.id, cursor, { status: 'failed', error: inst.error, finishedAt: Date.now() });
    return getFleetUpdateStatus(tenantId);
  }

  const result = await runInstanceStep(inst, creds.token, () => persist(row.id, cursor));
  if (!result.ok) {
    inst.state = 'failed';
    inst.error = result.error;
    await persist(row.id, cursor, { status: 'failed', error: result.error, finishedAt: Date.now() });
    return getFleetUpdateStatus(tenantId);
  }

  inst.state = 'done';
  inst.progressPct = 100;
  inst.progressPhase = 'done';
  inst.drainSupported = result.drainSupported;
  // Reconcile-to-truth: verify reaching the target version wins even if an
  // earlier sub-step within this same call had recorded an error.
  delete inst.error;
  cursor.currentIndex += 1;
  const done = cursor.currentIndex >= cursor.instances.length;
  await persist(row.id, cursor, done ? { status: 'done', finishedAt: Date.now() } : {});
  return getFleetUpdateStatus(tenantId);
}
