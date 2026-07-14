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
 * Concurrency: start uses a serializable transaction; advance atomically claims
 * the existing bg_jobs.lease_until field. This keeps multiple admin tabs and
 * retried Vercel requests from dispatching the same update step twice.
 */

import { and, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { getCoreDb } from '$server/db/pg-client';
import { bgJobs } from '$server/db/pg-schema/bg-jobs';
import { listGatewaysForAdmin, getGatewayCredentialsById } from './gateway.pg.service';
import { gatewayCallToInstance } from '$lib/server/gateway-rpc';
import {
  dispatchExternalImageRollout,
  getExternalImageRolloutStatus,
  resolveExternalImageTarget,
  type ImageArtifact,
} from './fleet-update-controller.service';

const JOB_TYPE = 'fleet_update';
const ACTIVE_STATUSES = ['queued', 'running'] as const;
const POLL_INTERVAL_MS = 5000;
const VERIFY_TIMEOUT_MS = 240_000;
const EXTERNAL_VERIFY_TIMEOUT_MS = 15 * 60_000;
// Longer than update.run (290s) + verify (240s), with margin for persistence.
// A crashed request becomes reclaimable without allowing two live requests to
// dispatch update.run for the same instance.
const ADVANCE_LEASE_MS = 10 * 60_000;

export type FleetInstanceState =
  'pending' | 'draining' | 'updating' | 'verifying' | 'done' | 'failed';

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
  /** Capability-derived update path. Old gateways omit it and remain package-managed. */
  updateSource?: 'package' | 'external-image' | 'unknown';
  /** Stable deployment controller identity. Replicas with the same id are one rollout unit. */
  controllerId?: string;
  currentArtifact?: ImageArtifact;
  targetArtifact?: ImageArtifact;
  healthy?: boolean | null;
  rolloutStartedAt?: number;
  operationId?: string;
}

interface GatewayUpdateStatus {
  current?: string;
  connections?: number;
  healthy?: boolean;
  updateSource?: unknown;
  deployment?: unknown;
  runtime?: unknown;
}

interface NormalizedUpdateSource {
  kind: 'package' | 'external-image' | 'unknown';
  controllerId?: string;
  currentArtifact?: ImageArtifact;
  targetArtifact?: ImageArtifact;
  healthy?: boolean | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function artifact(value: unknown): ImageArtifact | undefined {
  const raw = record(value);
  if (!raw) return undefined;
  const parsed = {
    image: string(raw.image ?? raw.ref),
    digest: string(raw.digest ?? raw.imageDigest),
    version: string(raw.version ?? raw.imageVersion),
  };
  return parsed.image || parsed.digest || parsed.version ? parsed : undefined;
}

/** Tolerant during the mixed-fleet transition: prefer the explicit contract,
 * while accepting early deployment/runtime shapes from container builds. */
function normalizeUpdateSource(status: GatewayUpdateStatus): NormalizedUpdateSource {
  const source = record(status.updateSource);
  const deployment = record(status.deployment);
  const runtime = record(status.runtime);
  const raw = source ?? deployment ?? runtime;
  const rawKind = string(raw?.updateStrategy ?? raw?.kind ?? raw?.type ?? raw?.mode);
  const orchestrator = string(raw?.orchestrator);
  const isExternal =
    rawKind === 'external-image' ||
    rawKind === 'container' ||
    orchestrator === 'swarm' ||
    raw?.externallyManaged === true;
  if (!isExternal) return { kind: 'package', healthy: status.healthy ?? true };

  const cluster = string(raw?.clusterId ?? raw?.cluster);
  const stack = string(raw?.stack ?? raw?.stackName ?? raw?.service);
  const inferredController = cluster && stack ? `swarm:${cluster}/${stack}` : undefined;
  return {
    kind: 'external-image',
    controllerId: string(raw?.controllerId) ?? inferredController,
    currentArtifact:
      artifact(raw?.currentArtifact) ??
      artifact(raw?.artifact) ??
      artifact(raw?.current) ??
      artifact({
        image: raw?.image,
        digest: raw?.digest ?? raw?.imageDigest,
        version: raw?.version,
      }),
    targetArtifact:
      artifact(raw?.targetArtifact) ??
      artifact(raw?.availableArtifact) ??
      artifact(raw?.target ?? raw?.available),
    // The authenticated update.status response itself is the liveness proof;
    // an explicit unhealthy signal overrides it.
    healthy: typeof raw?.healthy === 'boolean' ? raw.healthy : (status.healthy ?? true),
  };
}

interface FleetCursor {
  targetVersion: string;
  targetSource?: FleetTargetSource;
  instances: FleetInstance[];
  currentIndex: number;
}

export type FleetJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type FleetTargetSource = 'package' | 'external-image' | 'mixed';

export interface FleetJobView {
  id: string;
  targetVersion: string;
  targetSource: FleetTargetSource;
  instances: FleetInstance[];
  currentIndex: number;
  status: FleetJobStatus;
  error: string | null;
  startedBy: string | null;
  active: boolean;
}

export interface FleetUpdateAvailability {
  current: string | null;
  pending: {
    version: string;
    source: 'check' | 'external-image';
    detectedAt: string;
    artifact?: ImageArtifact;
  } | null;
  updateSource: 'package' | 'external-image' | 'mixed';
  targetSource: FleetTargetSource;
  targetArtifact?: ImageArtifact;
}

/** Fleet-aware availability replaces the selected-gateway npm check for
 * externally managed deployments. It resolves each controller's mutable tag
 * to a digest and reports pending when any replica differs. */
export async function getFleetUpdateAvailability(
  forceCheck = false,
): Promise<FleetUpdateAvailability | null> {
  const rows = await listGatewaysForAdmin();
  const snapshots: Array<{
    status: GatewayUpdateStatus & { pending?: { version?: string } | null };
    source: NormalizedUpdateSource;
  }> = [];
  for (const row of rows) {
    const creds = await getGatewayCredentialsById(row.id);
    if (!creds) continue;
    try {
      let status = await gatewayCallToInstance<
        GatewayUpdateStatus & { pending?: { version?: string } | null }
      >(creds.url, creds.token, 'update.status', {}, { timeoutMs: 8000 });
      const source = normalizeUpdateSource(status);
      if (forceCheck && source.kind === 'package') {
        status = await gatewayCallToInstance<
          GatewayUpdateStatus & { pending?: { version?: string } | null }
        >(creds.url, creds.token, 'update.check', {}, { timeoutMs: 20_000 });
      }
      snapshots.push({ status, source });
    } catch {
      // Availability remains useful when one replica is temporarily down;
      // the rollout snapshot itself will retain and surface that instance.
    }
  }
  if (snapshots.length === 0) return null;

  const external = snapshots.filter((snapshot) => snapshot.source.kind === 'external-image');
  const packages = snapshots.filter((snapshot) => snapshot.source.kind === 'package');
  if (external.length === 0) return null;
  if (external.some((snapshot) => !snapshot.source.controllerId)) {
    throw new Error('external-image gateway did not advertise a stable controllerId');
  }
  const controllerIds = new Set(
    external.map((snapshot) => snapshot.source.controllerId).filter(Boolean),
  );
  let imagePending = false;
  let targetArtifact: ImageArtifact | undefined;
  for (const controllerId of controllerIds) {
    const members = external.filter((snapshot) => snapshot.source.controllerId === controllerId);
    const target = await resolveExternalImageTarget(
      controllerId!,
      members.flatMap((member) =>
        member.source.currentArtifact ? [member.source.currentArtifact] : [],
      ),
    );
    targetArtifact ??= target;
    if (members.some((member) => member.source.currentArtifact?.digest !== target.digest))
      imagePending = true;
  }
  const packagePending = packages
    .map((snapshot) => snapshot.status.pending?.version)
    .find((version): version is string => typeof version === 'string' && version.length > 0);
  // In a mixed fleet, image-only availability must not feed a digest into
  // package update.run. Use the package target when one exists, otherwise its
  // current version so package instances snapshot as already done.
  const packageCurrent = packages
    .map((snapshot) => snapshot.status.current)
    .find((version): version is string => typeof version === 'string' && version.length > 0);
  const version =
    packagePending ??
    packageCurrent ??
    targetArtifact?.version ??
    targetArtifact?.digest ??
    'latest-image';
  const packageIsPending = !!packagePending;
  const targetSource: FleetTargetSource =
    imagePending && packageIsPending ? 'mixed' : imagePending ? 'external-image' : 'package';
  return {
    current: snapshots[0].status.current ?? external[0]?.source.currentArtifact?.version ?? null,
    pending:
      imagePending || packagePending
        ? {
            version,
            source: imagePending ? 'external-image' : 'check',
            detectedAt: new Date().toISOString(),
            artifact: targetArtifact,
          }
        : null,
    updateSource: packages.length > 0 ? 'mixed' : 'external-image',
    targetSource,
    targetArtifact,
  };
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

function artifactReached(
  source: NormalizedUpdateSource,
  targetArtifact: ImageArtifact | undefined,
  targetVersion: string,
): boolean {
  if (source.kind === 'package') return false;
  const current = source.currentArtifact;
  if (targetArtifact?.digest)
    return current?.digest === targetArtifact.digest && source.healthy === true;
  if (targetArtifact?.version)
    return current?.version === targetArtifact.version && source.healthy === true;
  return current?.version === targetVersion && source.healthy === true;
}

function externalInstanceReached(inst: FleetInstance, source: NormalizedUpdateSource): boolean {
  const current = source.currentArtifact;
  if (inst.targetArtifact?.digest) {
    return current?.digest === inst.targetArtifact.digest && source.healthy === true;
  }
  if (inst.targetArtifact?.version) {
    return current?.version === inst.targetArtifact.version && source.healthy === true;
  }
  if (isAtOrPast(current?.version, inst.toVersion)) return source.healthy === true;
  // A controller that resolves "latest" may not know the registry digest at
  // dispatch time. A changed immutable digest plus health is still strong,
  // observable convergence evidence; never use package VERSION for this path.
  return !!(
    inst.currentArtifact?.digest &&
    current?.digest &&
    current.digest !== inst.currentArtifact.digest &&
    source.healthy === true
  );
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
      const status = await gatewayCallToInstance<GatewayUpdateStatus>(
        creds.url,
        creds.token,
        'update.status',
        {},
        { timeoutMs: 8000 },
      );
      current = status.current;
      const source = normalizeUpdateSource(status);
      // Migration reconciliation: legacy failed cursors expected an npm
      // VERSION that immutable containers can never report. Once a reachable
      // instance proves it is externally image-managed, that old predicate is
      // incompatible and the phantom failure can be retired.
      if (inst.updateSource !== 'external-image' && source.kind === 'external-image') {
        confirmed = true;
        continue;
      }
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
    targetSource: cursor.targetSource ?? 'mixed',
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
      and(
        eq(bgJobs.tenantId, tenantId),
        eq(bgJobs.type, JOB_TYPE),
        inArray(bgJobs.status, [...ACTIVE_STATUSES]),
      ),
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

/**
 * Snapshot the fleet from the `gateway` rows, order least-connections-first
 * (ties by created_at — canary = first), persist a new job. Refuses if a
 * fleet job is already active for this tenant.
 */
export async function startFleetUpdate(
  tenantId: string,
  userId: string | null,
  targetVersion: string,
  targetSource: FleetTargetSource = 'mixed',
): Promise<FleetJobView> {
  if (!targetVersion) throw new Error('targetVersion is required');
  if (!['package', 'external-image', 'mixed'].includes(targetSource)) {
    throw new Error('invalid targetSource');
  }
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
          source: { kind: 'unknown', healthy: null } satisfies NormalizedUpdateSource,
        };
      }
      try {
        const status = await gatewayCallToInstance<GatewayUpdateStatus>(
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
          // Unknown load is not a safe canary signal. Older gateways that omit
          // this field may also lack graceful drain support, so sort them last.
          sortConnections: known ? (status.connections as number) : Number.POSITIVE_INFINITY,
          createdAt: row.createdAt,
          source: normalizeUpdateSource(status),
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
          source: { kind: 'unknown', healthy: null } satisfies NormalizedUpdateSource,
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
    state:
      s.source.kind === 'package' && targetSource === 'external-image'
        ? 'done'
        : s.source.kind === 'external-image' && targetSource === 'package'
          ? 'done'
          : s.source.kind === 'external-image'
            ? artifactReached(s.source, s.source.targetArtifact, targetVersion)
              ? 'done'
              : 'pending'
            : isAtOrPast(s.current, targetVersion)
              ? 'done'
              : 'pending',
    connections: s.connections,
    fromVersion: s.current,
    toVersion: targetVersion,
    updateSource: s.source.kind,
    controllerId: s.source.controllerId,
    currentArtifact: s.source.currentArtifact,
    targetArtifact: s.source.targetArtifact,
    healthy: s.source.healthy,
  }));

  const controllerIds = new Set(
    instances
      .filter(
        (instance) =>
          targetSource !== 'package' &&
          instance.updateSource === 'external-image' &&
          instance.controllerId,
      )
      .map((instance) => instance.controllerId!),
  );
  for (const controllerId of controllerIds) {
    const members = instances.filter((instance) => instance.controllerId === controllerId);
    try {
      const explicit = members.find(
        (member) => member.targetArtifact?.digest || member.targetArtifact?.version,
      )?.targetArtifact;
      const target =
        explicit ??
        (await resolveExternalImageTarget(
          controllerId,
          members.flatMap((member) => (member.currentArtifact ? [member.currentArtifact] : [])),
        ));
      for (const member of members) {
        member.targetArtifact = target;
        const normalized: NormalizedUpdateSource = {
          kind: 'external-image',
          currentArtifact: member.currentArtifact,
          healthy: member.healthy,
        };
        if (artifactReached(normalized, target, targetVersion)) member.state = 'done';
      }
    } catch (err) {
      const message = `could not resolve target image for ${controllerId}: ${String((err as Error)?.message ?? err)}`;
      for (const member of members) {
        member.state = 'failed';
        member.error = message;
      }
    }
  }

  for (const inst of instances) {
    if (inst.updateSource === 'unknown') {
      inst.state = 'failed';
      inst.error = 'could not determine update source while gateway unreachable';
    }
    if (
      targetSource !== 'package' &&
      inst.updateSource === 'external-image' &&
      !inst.controllerId
    ) {
      inst.state = 'failed';
      inst.error = 'gateway advertises external-image updates without a stable controllerId';
    }
  }

  let currentIndex = instances.findIndex((i) => i.state !== 'done');
  if (currentIndex === -1) currentIndex = instances.length;
  const invalid = instances.find((instance) => instance.state === 'failed');
  const status: FleetJobStatus = invalid
    ? 'failed'
    : currentIndex >= instances.length
      ? 'done'
      : 'running';

  const id = randomUUID();
  const now = Date.now();
  const db = getCoreDb();
  // The schema predates fleet jobs and has no partial unique index for one
  // active job per tenant. A SERIALIZABLE transaction makes the predicate read
  // ("no active fleet job") and insert atomic across Vercel instances: one of
  // two concurrent starts commits and PostgreSQL aborts the other.
  await db.transaction(
    async (tx) => {
      const [active] = await tx
        .select({ id: bgJobs.id })
        .from(bgJobs)
        .where(
          and(
            eq(bgJobs.tenantId, tenantId),
            eq(bgJobs.type, JOB_TYPE),
            inArray(bgJobs.status, [...ACTIVE_STATUSES]),
          ),
        )
        .limit(1);
      if (active) throw new Error('A fleet update is already in progress');

      await tx.insert(bgJobs).values({
        id,
        tenantId,
        userId,
        type: JOB_TYPE,
        refId: null,
        status,
        cursor: JSON.stringify({
          targetVersion,
          targetSource,
          instances,
          currentIndex,
        } satisfies FleetCursor),
        attempts: 0,
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        finishedAt: status === 'done' || status === 'failed' ? now : null,
        error: invalid?.error ?? null,
      });
    },
    { isolationLevel: 'serializable' },
  );

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
  return {
    ok: false,
    error: `did not reach ${inst.toVersion} within ${VERIFY_TIMEOUT_MS / 1000}s`,
  };
}

async function runExternalImageStep(
  members: Array<{ inst: FleetInstance; token: string }>,
  persistNow: () => Promise<void>,
): Promise<{ ok: true } | { ok: false; error: string; pending?: boolean }> {
  const first = members[0]?.inst;
  if (!first?.controllerId)
    return { ok: false, error: 'external-image rollout has no controllerId' };

  if (!first.rolloutStartedAt) {
    const startedAt = Date.now();
    const operationId = first.operationId ?? randomUUID();
    for (const { inst } of members) {
      inst.state = 'updating';
      inst.progressPct = 10;
      inst.progressPhase = 'controller-dispatch';
      inst.rolloutStartedAt = startedAt;
      inst.operationId = operationId;
    }
    await persistNow().catch(() => {});

    try {
      const result = await dispatchExternalImageRollout({
        operationId,
        controllerId: first.controllerId,
        targetVersion: first.toVersion,
        targetArtifact: first.targetArtifact ?? {},
      });
      if (result.artifact) {
        for (const { inst } of members) inst.targetArtifact = result.artifact;
      }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err) };
    }
  }

  let controllerStatus;
  try {
    controllerStatus = await getExternalImageRolloutStatus(first.operationId!);
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) };
  }
  if (!controllerStatus || controllerStatus.status !== 'completed') {
    await persistNow().catch(() => {});
    if (Date.now() - (first.rolloutStartedAt ?? Date.now()) >= EXTERNAL_VERIFY_TIMEOUT_MS) {
      return {
        ok: false,
        error: `external image controller operation ${first.operationId} timed out`,
      };
    }
    return { ok: false, pending: true, error: 'external image controller is still running' };
  }
  if (controllerStatus.conclusion !== 'success') {
    return {
      ok: false,
      error: `external image controller operation ${first.operationId} completed with ${controllerStatus.conclusion ?? 'no conclusion'}`,
    };
  }

  for (const { inst } of members) {
    inst.state = 'verifying';
    inst.progressPct = 60;
    inst.progressPhase = 'image-rollout';
  }
  await persistNow().catch(() => {});

  await sleep(POLL_INTERVAL_MS);
  for (const { inst, token } of members) {
    if (inst.state === 'done') continue;
    try {
      const status = await gatewayCallToInstance<GatewayUpdateStatus>(
        inst.url,
        token,
        'update.status',
        {},
        { timeoutMs: 8000 },
      );
      const source = normalizeUpdateSource(status);
      const hasReached = externalInstanceReached(inst, source);
      inst.healthy = source.healthy;
      if (hasReached) {
        inst.currentArtifact = source.currentArtifact;
        inst.state = 'done';
        inst.progressPct = 100;
        inst.progressPhase = 'done';
        delete inst.error;
      } else {
        inst.progressPhase = 'waiting-for-image';
      }
    } catch (err) {
      const message = String((err as Error)?.message ?? err);
      if (isExplicitErrorResponse(message)) return { ok: false, error: `${inst.name}: ${message}` };
    }
  }
  await persistNow().catch(() => {});
  if (members.every(({ inst }) => inst.state === 'done')) return { ok: true };

  const startedAt = first.rolloutStartedAt ?? Date.now();
  if (Date.now() - startedAt < EXTERNAL_VERIFY_TIMEOUT_MS) {
    return { ok: false, pending: true, error: 'external image rollout is still converging' };
  }

  const missing = members
    .filter(({ inst }) => inst.state !== 'done')
    .map(({ inst }) => inst.name)
    .join(', ');
  return {
    ok: false,
    error: `controller ${first.controllerId} did not converge ${missing} to the target image within ${EXTERNAL_VERIFY_TIMEOUT_MS / 1000}s`,
  };
}

/**
 * Advance the active job by exactly one instance step. No-op (returns the
 * current view) if there is no active job — covers a stale/duplicate call
 * after the job already finished, failed, or was aborted.
 */
export async function advanceFleetUpdate(tenantId: string): Promise<FleetJobView | null> {
  const db = getCoreDb();
  const now = Date.now();
  const leaseUntil = now + ADVANCE_LEASE_MS;
  // Atomic claim: only one request can move an unleased/expired active row to
  // this lease value. Concurrent callers return status without dispatching a
  // second update.run. leaseUntil is an existing bg_jobs recovery field.
  const [row] = await db
    .update(bgJobs)
    .set({ leaseUntil, updatedAt: now })
    .where(
      and(
        eq(bgJobs.tenantId, tenantId),
        eq(bgJobs.type, JOB_TYPE),
        inArray(bgJobs.status, [...ACTIVE_STATUSES]),
        or(isNull(bgJobs.leaseUntil), lt(bgJobs.leaseUntil, now)),
      ),
    )
    .returning();
  if (!row) return getFleetUpdateStatus(tenantId);

  const persistClaimed = async (
    cursor: FleetCursor,
    patch: { status?: FleetJobStatus; error?: string | null; finishedAt?: number | null } = {},
    release = false,
  ): Promise<boolean> => {
    const updated = await db
      .update(bgJobs)
      .set({
        cursor: JSON.stringify(cursor),
        updatedAt: Date.now(),
        ...(release ? { leaseUntil: null } : {}),
        ...patch,
      })
      .where(
        and(eq(bgJobs.id, row.id), eq(bgJobs.status, 'running'), eq(bgJobs.leaseUntil, leaseUntil)),
      )
      .returning({ id: bgJobs.id });
    return updated.length === 1;
  };

  const cursor = JSON.parse(row.cursor ?? '{}') as FleetCursor;
  // Skip any instances already on target (bookkeeping only — no RPC calls).
  while (
    cursor.currentIndex < cursor.instances.length &&
    cursor.instances[cursor.currentIndex].state === 'done'
  ) {
    cursor.currentIndex += 1;
  }
  if (cursor.currentIndex >= cursor.instances.length) {
    await persistClaimed(cursor, { status: 'done', finishedAt: Date.now() }, true);
    return getFleetUpdateStatus(tenantId);
  }

  const inst = cursor.instances[cursor.currentIndex];
  const externalMembers =
    inst.updateSource === 'external-image' && inst.controllerId
      ? cursor.instances.filter(
          (candidate) =>
            candidate.updateSource === 'external-image' &&
            candidate.controllerId === inst.controllerId &&
            candidate.state !== 'done',
        )
      : [inst];
  const membersWithCredentials: Array<{ inst: FleetInstance; token: string }> = [];
  for (const member of externalMembers) {
    const creds = await getGatewayCredentialsById(member.gatewayId);
    if (!creds) {
      member.state = 'failed';
      member.error = 'gateway credentials not found';
      await persistClaimed(
        cursor,
        { status: 'failed', error: member.error, finishedAt: Date.now() },
        true,
      );
      return getFleetUpdateStatus(tenantId);
    }
    membersWithCredentials.push({ inst: member, token: creds.token });
  }

  const result =
    inst.updateSource === 'external-image'
      ? await runExternalImageStep(membersWithCredentials, async () => {
          await persistClaimed(cursor);
        })
      : await runInstanceStep(inst, membersWithCredentials[0].token, async () => {
          await persistClaimed(cursor);
        });
  if (!result.ok) {
    if ('pending' in result && result.pending) {
      await persistClaimed(cursor, {}, true);
      return getFleetUpdateStatus(tenantId);
    }
    for (const member of externalMembers) {
      if (member.state !== 'done') {
        member.state = 'failed';
        member.error = result.error;
      }
    }
    await persistClaimed(
      cursor,
      { status: 'failed', error: result.error, finishedAt: Date.now() },
      true,
    );
    return getFleetUpdateStatus(tenantId);
  }

  for (const member of externalMembers) {
    member.state = 'done';
    member.progressPct = 100;
    member.progressPhase = 'done';
    if ('drainSupported' in result && typeof result.drainSupported === 'boolean') {
      member.drainSupported = result.drainSupported;
    }
    delete member.error;
  }
  do cursor.currentIndex += 1;
  while (
    cursor.currentIndex < cursor.instances.length &&
    cursor.instances[cursor.currentIndex].state === 'done'
  );
  const done = cursor.currentIndex >= cursor.instances.length;
  await persistClaimed(cursor, done ? { status: 'done', finishedAt: Date.now() } : {}, true);
  return getFleetUpdateStatus(tenantId);
}
