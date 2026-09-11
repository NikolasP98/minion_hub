import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getOrgTransactionDb } from '$server/db/pg-client';
import { bgJobs } from '$server/db/pg-schema/bg-jobs';
import { jobEffects } from '$server/db/pg-schema/job-effects';
import { withOrgCoreTransaction, type CoreTx, type OrgScope } from '$server/db/with-org-core';
import type { AdvanceResult, BgJob, JobExecution } from './bg-runtime';
import {
  prepareEmbeddingRequest,
  executeEmbeddingRequest,
  EMBEDDING_DIMENSIONS,
  type EmbeddingDescriptor,
} from './embeddings';

export type JobEntity = Readonly<{ family: string; entityId: string }>;
export type JobRequest = JobEntity & Readonly<{ revision: string; sourceHash: string }>;
type Progress = Record<string, unknown>;
type ReceiptDescriptor = EmbeddingDescriptor & { pipelineVersion: string };
type Row = typeof jobEffects.$inferSelect;
type NewJob = { type: string; userId?: string | null; refId?: string | null; cursor?: Progress };
export type DomainGuard = (tx: CoreTx, current: BgJob) => Promise<void>;
export type ExpectedEmbeddingProvider = Pick<
  EmbeddingDescriptor,
  'endpoint' | 'model' | 'normalization' | 'dimensions'
>;
export type JobEmbeddingOptions = {
  expectedManifestHash?: string;
  expectedProvider?: ExpectedEmbeddingProvider;
  validateDomain?: DomainGuard;
};
const HASH = /^[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CURSOR_KEY = '__jobRequest';

export class JobEffectError extends Error {
  constructor(
    readonly code: 'ownership_lost' | 'superseded' | 'conflict' | 'indeterminate',
    message: string,
  ) {
    super(message);
    this.name = 'JobEffectError';
  }
}
const conflict = (message: string): never => {
  throw new JobEffectError('conflict', message);
};
function text(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    !value.includes('\0')
  );
}
function entity(value: JobEntity) {
  if (
    !value ||
    !text(value.family, 96) ||
    !/^[a-zA-Z0-9_.:-]+$/.test(value.family) ||
    !text(value.entityId, 512)
  )
    conflict('Invalid job entity identity');
}
function requestValid(value: unknown): asserts value is JobRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) conflict('Invalid job request');
  const candidate = value as JobRequest;
  entity(candidate);
  if (
    typeof candidate.revision !== 'string' ||
    typeof candidate.sourceHash !== 'string' ||
    !REVISION.test(candidate.revision) ||
    !HASH.test(candidate.sourceHash)
  )
    conflict('Invalid job request revision or source hash');
}
function scopeValid(scope: OrgScope) {
  if (!text(scope.tenantId, 256)) conflict('Invalid job tenant');
}
function manifestValid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !HASH.test(value)) conflict('Invalid job manifest hash');
}
function assertManifest(head: Row, expected: string | undefined, required = false) {
  if (expected !== undefined && head.manifestHash !== expected)
    conflict('Job manifest differs from the bound request');
  if (required && head.manifestHash !== null && expected === undefined)
    conflict('Manifest-bound effects require an expected manifest');
}
function embeddingOptions(value: JobEmbeddingOptions): JobEmbeddingOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    conflict('Invalid embedding contract');
  const { expectedManifestHash, expectedProvider, validateDomain } = value;
  if (expectedManifestHash !== undefined) manifestValid(expectedManifestHash);
  if (validateDomain !== undefined && typeof validateDomain !== 'function')
    conflict('Invalid domain guard');
  if ((expectedManifestHash === undefined) !== (expectedProvider === undefined))
    conflict('Embedding contract requires both manifest and provider');
  if (expectedProvider !== undefined) {
    if (
      !expectedProvider ||
      typeof expectedProvider !== 'object' ||
      Array.isArray(expectedProvider) ||
      !text(expectedProvider.endpoint, 512) ||
      !text(expectedProvider.model, 128) ||
      !text(expectedProvider.normalization, 128) ||
      expectedProvider.dimensions !== EMBEDDING_DIMENSIONS
    )
      conflict('Invalid expected embedding provider');
    return {
      expectedManifestHash,
      expectedProvider: {
        endpoint: expectedProvider.endpoint,
        model: expectedProvider.model,
        normalization: expectedProvider.normalization,
        dimensions: expectedProvider.dimensions,
      },
      validateDomain,
    };
  }
  return { expectedManifestHash, validateDomain };
}
function identityKey(
  tenantId: string,
  identity: JobEntity,
  kind: 'head' | 'effect',
  revision = '',
  unit = '',
) {
  return createHash('sha256')
    .update(JSON.stringify([tenantId, identity.family, identity.entityId, kind, revision, unit]))
    .digest('hex');
}
function progress(value: unknown): Progress {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    conflict('Invalid job progress object');
  return value as Progress;
}
function jobProgress(job: Pick<BgJob, 'cursor'>): Progress {
  if (job.cursor === null) return {};
  try {
    return progress(JSON.parse(job.cursor));
  } catch {
    return conflict('Invalid persisted job cursor');
  }
}
export function readJobRequest(job: Pick<BgJob, 'cursor'>): JobRequest | null {
  const value = jobProgress(job)[CURSOR_KEY];
  if (value === undefined) return null;
  requestValid(value);
  return {
    family: value.family,
    entityId: value.entityId,
    revision: value.revision,
    sourceHash: value.sourceHash,
  };
}
function same(a: JobRequest, b: JobRequest) {
  return (
    a.family === b.family &&
    a.entityId === b.entityId &&
    a.revision === b.revision &&
    a.sourceHash === b.sourceHash
  );
}
function encodedProgress(current: Pick<BgJob, 'cursor'>, request: JobRequest, next?: Progress) {
  const body = next === undefined ? jobProgress(current) : progress(next);
  return JSON.stringify({ ...body, [CURSOR_KEY]: request });
}
function toRequest(row: Row): JobRequest {
  return {
    family: row.family,
    entityId: row.entityId,
    revision: row.revision,
    sourceHash: row.sourceHash,
  };
}
async function lockedHead(
  tx: CoreTx,
  scope: OrgScope,
  identity: JobEntity,
  create?: { sourceHash: string; legacyJobId?: string },
) {
  const id = identityKey(scope.tenantId, identity, 'head');
  if (create)
    await tx
      .insert(jobEffects)
      .values({
        id,
        tenantId: scope.tenantId,
        ...identity,
        kind: 'head',
        revision: randomUUID(),
        unit: '',
        sourceHash: create.sourceHash,
        state: 'active',
        legacyJobId: create.legacyJobId ?? null,
      })
      .onConflictDoNothing({ target: jobEffects.id });
  const [row] = await tx
    .select()
    .from(jobEffects)
    .where(and(eq(jobEffects.id, id), eq(jobEffects.tenantId, scope.tenantId)))
    .for('update');
  if (!row || row.kind !== 'head')
    throw new JobEffectError('superseded', 'Job request head is missing');
  return row;
}
function assertHead(head: Row, request: JobRequest) {
  if (head.state !== 'active' || !same(toRequest(head), request))
    throw new JobEffectError('superseded', 'Job request was superseded or revoked');
}
function executionValid(execution: JobExecution, scope: OrgScope) {
  scopeValid(scope);
  if (execution.tenantId !== scope.tenantId)
    conflict('Execution tenant differs from domain tenant');
  if (execution.signal.aborted)
    throw new JobEffectError('ownership_lost', 'Job ownership was cancelled');
}
async function owned<T>(
  execution: JobExecution,
  scope: OrgScope,
  operation: (tx: CoreTx, current: BgJob) => Promise<T>,
) {
  executionValid(execution, scope);
  try {
    return await execution.withOwnership(async (tx, current) => {
      if (
        current.tenantId !== scope.tenantId ||
        current.id !== execution.jobId ||
        current.leaseGeneration !== execution.leaseGeneration ||
        current.status !== 'running'
      )
        throw new JobEffectError('ownership_lost', 'Current job does not match execution');
      return operation(tx, current);
    });
  } catch (error) {
    if (
      execution.signal.aborted ||
      (error instanceof Error && error.message === 'background job ownership lost')
    )
      throw new JobEffectError('ownership_lost', 'Job ownership was lost');
    throw error;
  }
}
async function saveProgress(tx: CoreTx, current: BgJob, request: JobRequest, next?: Progress) {
  await tx
    .update(bgJobs)
    .set({ cursor: encodedProgress(current, request, next), updatedAt: Date.now() })
    .where(
      and(
        eq(bgJobs.id, current.id),
        eq(bgJobs.tenantId, current.tenantId),
        eq(bgJobs.leaseGeneration, current.leaseGeneration),
        eq(bgJobs.status, 'running'),
      ),
    );
}

/** Reservation contention is not a terminal job failure. Missing owners require recovery. */
export class JobReservationOwnerError extends Error {
  constructor(
    readonly code: 'owner_busy' | 'owner_missing' | 'capacity',
    message: string,
  ) {
    super(message);
    this.name = 'JobReservationOwnerError';
  }
}

/** Share the existing canonical head identity without changing single-head callers. */
export function jobEffectHeadId(tenantId: string, identity: JobEntity): string {
  if (!text(tenantId, 256)) conflict('Invalid job tenant');
  entity(identity);
  return identityKey(tenantId, identity, 'head');
}

/** Current job -> NOWAIT foreign jobs -> scoped domain. No job grants for app_ledger. */
export async function withOwnedJobScope<T>(
  execution: JobExecution,
  scope: OrgScope,
  operation: (tx: CoreTx, current: BgJob) => Promise<{ value: T; nextProgress?: Progress }>,
  options?: Readonly<{
    foreignReservationOwners: readonly Readonly<{ jobId: string; reservationGeneration: number }>[];
  }>,
): Promise<T> {
  scope = { ...scope };
  const references = options?.foreignReservationOwners ?? [];
  if (!Array.isArray(references)) conflict('Invalid reservation owner set');
  if (references.length > 256)
    throw new JobReservationOwnerError('capacity', 'Reservation owner count exceeds 256');
  const owners = new Map<string, Set<number>>();
  for (const reference of references) {
    if (
      !reference ||
      !text(reference.jobId, 256) ||
      !Number.isSafeInteger(reference.reservationGeneration) ||
      reference.reservationGeneration < 0 ||
      reference.reservationGeneration > 2_147_483_647
    )
      conflict('Invalid reservation owner');
    const generations = owners.get(reference.jobId) ?? new Set<number>();
    generations.add(reference.reservationGeneration);
    owners.set(reference.jobId, generations);
  }
  const ordered = [...owners].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const serialized: string[] = [];
  let manifestBytes = 2; // Array framing; count exact escaped records before aggregate allocation.
  for (const [jobId, generations] of ordered) {
    if (jobId === execution.jobId) continue; // Actor is separately locked; never a 257th foreign ref.
    for (const reservationGeneration of [...generations].sort((a, b) => a - b)) {
      const record = JSON.stringify({ jobId, reservationGeneration });
      manifestBytes += Buffer.byteLength(record, 'utf8') + (serialized.length ? 1 : 0);
      if (manifestBytes > 131_072)
        throw new JobReservationOwnerError(
          'capacity',
          'Reservation owner manifest exceeds 128 KiB',
        );
      serialized.push(record);
    }
  }
  const manifest = `[${serialized.join(',')}]`;
  return owned(execution, scope, async (tx, current) => {
    for (const [jobId, generations] of ordered) {
      if (jobId === current.id) continue; // The current job is already locked by execution.
      let foreign: BgJob | undefined;
      try {
        [foreign] = await tx
          .select()
          .from(bgJobs)
          .where(and(eq(bgJobs.id, jobId), eq(bgJobs.tenantId, scope.tenantId)))
          .for('update', { noWait: true });
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : error instanceof Error &&
                error.cause &&
                typeof error.cause === 'object' &&
                'code' in error.cause
              ? error.cause.code
              : undefined;
        if (code === '55P03')
          throw new JobReservationOwnerError('owner_busy', 'Reservation owner is locked');
        throw error;
      }
      if (!foreign)
        throw new JobReservationOwnerError(
          'owner_missing',
          'Reservation owner is missing; recovery required',
        );
      if (
        foreign.status === 'running' &&
        (foreign.leaseUntil ?? 0) > Date.now() &&
        generations.has(foreign.leaseGeneration)
      )
        throw new JobReservationOwnerError('owner_busy', 'Reservation owner is still current');
    }
    // Trusted-service labels catch stale/accidentally unscoped writes. They are not
    // authentication against arbitrary SQL, which can forge both actor and manifest.
    // Nested actor context is restored; recursively opening owned transactions is unsupported.
    const [previous] = await tx.execute<{
      actor: string | null;
      generation: string | null;
      owners: string | null;
    }>(sql`
      select current_setting('app.job_effect_job_id', true) as actor,
        current_setting('app.job_effect_lease_generation', true) as generation,
        current_setting('app.job_effect_prelocked_owners', true) as owners`);
    if (!previous) throw new Error('Cannot capture job actor context');
    let failed = false;
    let result: { value: T; nextProgress?: Progress };
    try {
      await tx.execute(sql`select set_config('app.job_effect_job_id', ${current.id}, true),
        set_config('app.job_effect_lease_generation', ${String(current.leaseGeneration)}, true),
        set_config('app.job_effect_prelocked_owners', ${manifest}, true)`);
      result = await withOrgCoreTransaction(scope, tx, (domain) => operation(domain, current));
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        await tx.execute(sql`select set_config('app.job_effect_job_id', ${previous.actor ?? ''}, true),
          set_config('app.job_effect_lease_generation', ${previous.generation ?? ''}, true),
          set_config('app.job_effect_prelocked_owners', ${previous.owners ?? ''}, true)`);
      } catch (restoreError) {
        if (!failed) throw restoreError; // Aborted SQL preserves its original failure; outer owner rolls back.
      }
    }
    if (result.nextProgress !== undefined) {
      const cursor = JSON.stringify(progress(result.nextProgress));
      await tx
        .update(bgJobs)
        .set({ cursor, updatedAt: Date.now() })
        .where(
          and(
            eq(bgJobs.id, current.id),
            eq(bgJobs.tenantId, current.tenantId),
            eq(bgJobs.leaseGeneration, current.leaseGeneration),
            eq(bgJobs.status, 'running'),
          ),
        );
    }
    return result.value;
  });
}

/** Current job -> head -> domain lock order; callback is database-only and RLS scoped.
 * Cursor bookkeeping follows scope restoration, on the SAME transaction. */
export async function withJobRequest<T>(
  execution: JobExecution,
  scope: OrgScope,
  request: JobRequest,
  operation: (tx: CoreTx, current: BgJob) => Promise<T>,
  nextProgress?: Progress | ((result: T) => Progress | undefined),
  expectedManifestHash?: string,
): Promise<T> {
  requestValid(request);
  if (expectedManifestHash !== undefined) manifestValid(expectedManifestHash);
  request = { ...request };
  scope = { ...scope };
  return owned(execution, scope, async (tx, current) => {
    const binding = readJobRequest(current);
    if (!binding || !same(binding, request)) conflict('Job cursor is not bound to this request');
    const result = await withOrgCoreTransaction(scope, tx, async (domain) => {
      const head = await lockedHead(domain, scope, request);
      assertHead(head, request);
      assertManifest(head, expectedManifestHash);
      return operation(domain, current);
    });
    const next = typeof nextProgress === 'function' ? nextProgress(result) : nextProgress;
    if (next !== undefined) await saveProgress(tx, current, request, next);
    return result;
  });
}

/** Bind the complete execution plan once, after the trusted domain guard.
 * A guard may signal already-published without changing this head or progress. */
export async function bindJobManifest(
  execution: JobExecution,
  scope: OrgScope,
  request: JobRequest,
  manifestHash: string,
  validateDomain: DomainGuard,
  nextProgress?: Progress,
): Promise<void> {
  manifestValid(manifestHash);
  if (typeof validateDomain !== 'function') conflict('Invalid domain guard');
  scope = { ...scope };
  request = { ...request };
  if (nextProgress !== undefined)
    nextProgress = JSON.parse(JSON.stringify(progress(nextProgress))) as Progress;
  return withJobRequest(
    execution,
    scope,
    request,
    async (tx, current) => {
      await validateDomain(tx, current);
      const head = await lockedHead(tx, scope, request);
      assertHead(head, request);
      if (head.manifestHash !== null) {
        assertManifest(head, manifestHash);
        return;
      }
      const [prior] = await tx
        .select({ id: jobEffects.id })
        .from(jobEffects)
        .where(
          and(
            eq(jobEffects.tenantId, scope.tenantId),
            eq(jobEffects.family, request.family),
            eq(jobEffects.entityId, request.entityId),
            eq(jobEffects.revision, request.revision),
            eq(jobEffects.kind, 'effect'),
          ),
        )
        .limit(1);
      // TODO(handoff): Null manifest plus receipts requires explicit reingest or a
      // reviewed complete backfill, never inferred partial intent. See meta
      // proposals/2026-09-08-platform-qc-remediation.md (JOB-02).
      if (prior) conflict('Unbound request has existing effects; explicit new revision required');
      await tx
        .update(jobEffects)
        .set({ manifestHash, updatedAt: new Date() })
        .where(eq(jobEffects.id, head.id));
    },
    nextProgress,
  );
}

/** Return the canonical stored cursor: bg-runtime clears it if omitted on a
 * continuing result. Adopters call this after their atomic domain/progress step. */
export function jobRequestAdvanceResult(
  execution: JobExecution,
  scope: OrgScope,
  request: JobRequest,
  done = false,
): Promise<AdvanceResult> {
  return withJobRequest(execution, scope, request, async (_tx, current) => ({
    done,
    cursor: jobProgress(current),
  }));
}

/** Authorized user intent: head -> domain, then enqueue after restoring the role.
 * Never acquire an old running job after the head. A revision fences its result. */
export async function createJobRequest<T>(
  scope: OrgScope,
  identity: JobEntity,
  sourceHash: string,
  input: NewJob,
  mutate: (tx: CoreTx, request: JobRequest) => Promise<T>,
) {
  scope = { ...scope };
  identity = { ...identity };
  input = { ...input };
  scopeValid(scope);
  entity(identity);
  if (!HASH.test(sourceHash) || !text(input.type, 160)) conflict('Invalid job request identity');
  if (input.cursor !== undefined)
    input.cursor = JSON.parse(JSON.stringify(progress(input.cursor))) as Progress;
  return getOrgTransactionDb(scope.db).transaction(async (tx) => {
    const result = await withOrgCoreTransaction(scope, tx, async (domain) => {
      const head = await lockedHead(domain, scope, identity, { sourceHash });
      const request = { ...identity, sourceHash, revision: randomUUID() };
      await domain
        .update(jobEffects)
        .set({
          ...request,
          state: 'active',
          legacyJobId: null,
          manifestHash: null,
          updatedAt: new Date(),
        })
        .where(eq(jobEffects.id, head.id));
      return { request, value: await mutate(domain, request) };
    });
    const now = Date.now(),
      jobId = randomUUID();
    await tx.insert(bgJobs).values({
      id: jobId,
      tenantId: scope.tenantId,
      userId: input.userId ?? null,
      type: input.type,
      refId: input.refId ?? identity.entityId,
      status: 'queued',
      attempts: 0,
      cursor: JSON.stringify({ ...(input.cursor ?? {}), [CURSOR_KEY]: result.request }),
      createdAt: now,
      updatedAt: now,
    });
    return { ...result, jobId };
  });
}

export async function revokeJobRequest<T>(
  scope: OrgScope,
  identity: JobEntity,
  mutate: (tx: CoreTx) => Promise<T>,
) {
  scope = { ...scope };
  identity = { ...identity };
  scopeValid(scope);
  entity(identity);
  return getOrgTransactionDb(scope.db).transaction((tx) =>
    withOrgCoreTransaction(scope, tx, async (domain) => {
      const head = await lockedHead(domain, scope, identity, { sourceHash: '0'.repeat(64) });
      await domain
        .update(jobEffects)
        .set({
          revision: randomUUID(),
          state: 'revoked',
          legacyJobId: null,
          manifestHash: null,
          updatedAt: new Date(),
        })
        .where(eq(jobEffects.id, head.id));
      return mutate(domain);
    }),
  );
}

/** Legacy adoption is deliberately narrow: an existing head for another job
 * cannot attest that an unversioned job belongs to a later explicit request.
 * The validator must read/lock the actual domain request and reject ambiguity. */
export async function bindLegacyJobRequest(
  execution: JobExecution,
  scope: OrgScope,
  identity: JobEntity,
  sourceHash: string,
  validateDomain: (tx: CoreTx, current: BgJob) => Promise<void>,
): Promise<JobRequest> {
  scope = { ...scope };
  identity = { ...identity };
  entity(identity);
  if (!HASH.test(sourceHash)) conflict('Invalid source hash');
  return owned(execution, scope, async (tx, current) => {
    const request = await withOrgCoreTransaction(scope, tx, async (domain) => {
      const head = await lockedHead(domain, scope, identity, {
        sourceHash,
        legacyJobId: current.id,
      });
      await validateDomain(domain, current);
      const existing = readJobRequest(current);
      if (existing) {
        assertHead(head, existing);
        if (
          existing.family !== identity.family ||
          existing.entityId !== identity.entityId ||
          existing.sourceHash !== sourceHash
        )
          conflict('Legacy request identity mismatch');
        return existing;
      }
      if (
        head.legacyJobId !== current.id ||
        head.sourceHash !== sourceHash ||
        head.state !== 'active'
      )
        conflict('Unversioned job cannot adopt an existing request');
      return toRequest(head);
    });
    await saveProgress(tx, current, request);
    return request;
  });
}

/** Corpus unit admission: validate the CURRENT source under head/domain locks.
 * Calling this for a new unit is explicit; existing ambiguous receipts are never retried. */
export async function bindSourceJobRequest(
  execution: JobExecution,
  scope: OrgScope,
  identity: JobEntity,
  sourceHash: string,
  validateSource: (tx: CoreTx, current: BgJob) => Promise<void>,
): Promise<JobRequest> {
  scope = { ...scope };
  identity = { ...identity };
  entity(identity);
  if (!HASH.test(sourceHash)) conflict('Invalid source hash');
  return owned(execution, scope, async (tx, current) => {
    const request = await withOrgCoreTransaction(scope, tx, async (domain) => {
      const head = await lockedHead(domain, scope, identity, { sourceHash });
      await validateSource(domain, current);
      if (head.state === 'revoked')
        throw new JobEffectError('superseded', 'Source request was revoked');
      if (head.sourceHash === sourceHash) return toRequest(head);
      const next = { ...identity, sourceHash, revision: randomUUID() };
      await domain
        .update(jobEffects)
        .set({ ...next, legacyJobId: null, manifestHash: null, updatedAt: new Date() })
        .where(eq(jobEffects.id, head.id));
      return next;
    });
    await saveProgress(tx, current, request);
    return request;
  });
}

function descriptorEqual(value: unknown, expected: ReceiptDescriptor) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = value as Record<string, unknown>;
  return (
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, expectedValue]) => actual[key] === expectedValue)
  );
}
function vectors(value: unknown, count: number): number[][] {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 64 ||
    !Array.isArray(value) ||
    value.length !== count ||
    Array.from(value).some(
      (vector) =>
        !Array.isArray(vector) ||
        vector.length !== EMBEDDING_DIMENSIONS ||
        Array.from(vector).some(
          (component) => typeof component !== 'number' || !Number.isFinite(component),
        ),
    )
  )
    return conflict('Invalid persisted embedding vectors');
  return value as number[][];
}
function unitValid(unit: string) {
  if (!text(unit, 160)) conflict('Invalid effect unit');
}
async function receipt(tx: CoreTx, scope: OrgScope, request: JobRequest, unit: string) {
  const [row] = await tx
    .select()
    .from(jobEffects)
    .where(
      and(
        eq(jobEffects.id, identityKey(scope.tenantId, request, 'effect', request.revision, unit)),
        eq(jobEffects.tenantId, scope.tenantId),
      ),
    )
    .for('update');
  return row;
}

/** Durable admission precedes the one outbound attempt. A lost response leaves
 * admitted evidence and fails closed on replay; it is not proof of no remote effect. */
export async function runJobEmbedding(
  execution: JobExecution,
  scope: OrgScope,
  request: JobRequest,
  unit: string,
  texts: string[],
  pipelineVersion: string,
  options: JobEmbeddingOptions = {},
): Promise<number[][]> {
  scope = { ...scope };
  request = { ...request };
  unitValid(unit);
  if (
    !Array.isArray(texts) ||
    texts.length < 1 ||
    texts.length > 64 ||
    Array.from(texts).some((value) => typeof value !== 'string')
  )
    conflict('Invalid embedding batch inputs');
  if (!text(pipelineVersion, 128)) conflict('Invalid pipeline version');
  executionValid(execution, scope);
  options = embeddingOptions(options);
  const prepared = prepareEmbeddingRequest(texts);
  if (
    options.expectedProvider &&
    Object.entries(options.expectedProvider).some(
      ([key, value]) => prepared.descriptor[key as keyof ExpectedEmbeddingProvider] !== value,
    )
  )
    conflict('Prepared embedding provider differs from the expected manifest provider');
  const descriptor: ReceiptDescriptor = { ...prepared.descriptor, pipelineVersion };
  const admitted = await withJobRequest(
    execution,
    scope,
    request,
    async (tx, current) => {
      assertManifest(await lockedHead(tx, scope, request), options.expectedManifestHash, true);
      const existing = await receipt(tx, scope, request, unit);
      if (existing) {
        if (
          !descriptorEqual(existing.descriptor, descriptor) ||
          existing.sourceHash !== request.sourceHash
        )
          conflict('Effect request descriptor mismatch');
        if (existing.state === 'received' || existing.state === 'committed')
          return { replay: vectors(existing.result, descriptor.count) };
        // TODO(handoff): Add an explicitly reviewed indeterminate recovery policy;
        // do not purge/retry admissions. See meta proposals/2026-09-08-platform-qc-remediation.md (JOB-02).
        throw new JobEffectError('indeterminate', 'Embedding admission has no durable response');
      }
      await options.validateDomain?.(tx, current);
      await tx.insert(jobEffects).values({
        id: identityKey(scope.tenantId, request, 'effect', request.revision, unit),
        tenantId: scope.tenantId,
        ...request,
        kind: 'effect',
        unit,
        state: 'admitted',
        descriptor,
      });
      return { replay: null };
    },
    undefined,
    options.expectedManifestHash,
  );
  if (admitted.replay) return admitted.replay;
  executionValid(execution, scope);
  const result = await executeEmbeddingRequest(prepared, {
    signal: execution.signal,
    attemptPolicy: 'single',
  });
  return withJobRequest(
    execution,
    scope,
    request,
    async (tx) => {
      const row = await receipt(tx, scope, request, unit);
      if (!row || row.state !== 'admitted' || !descriptorEqual(row.descriptor, descriptor))
        conflict('Effect admission changed before response persistence');
      const valid = vectors(result, descriptor.count);
      await tx
        .update(jobEffects)
        .set({ state: 'received', result: valid, updatedAt: new Date() })
        .where(eq(jobEffects.id, row.id));
      return valid;
    },
    undefined,
    options.expectedManifestHash,
  );
}

/** Publish all units and progress atomically. A completed replay never invokes
 * the domain callback again; its stored cursor is the canonical result. */
export async function commitJobEffects<T>(
  execution: JobExecution,
  scope: OrgScope,
  request: JobRequest,
  units: string[],
  publish: (tx: CoreTx, current: BgJob) => Promise<T>,
  nextProgress: Progress,
  expectedManifestHash?: string,
): Promise<{ replayed: true; cursor: Progress } | { replayed: false; value: T }> {
  scope = { ...scope };
  request = { ...request };
  if (
    !Array.isArray(units) ||
    units.length < 1 ||
    units.length > 1024 ||
    new Set(units).size !== units.length
  )
    conflict('Invalid effect commit units');
  units.forEach(unitValid);
  units = [...units];
  progress(nextProgress);
  return withJobRequest(
    execution,
    scope,
    request,
    async (tx, current) => {
      assertManifest(await lockedHead(tx, scope, request), expectedManifestHash, true);
      const rows: Row[] = [];
      for (const unit of [...units].sort()) {
        const row = await receipt(tx, scope, request, unit);
        if (!row || !['received', 'committed'].includes(row.state))
          conflict('Effect has no received result');
        rows.push(row);
      }
      if (rows.every((row) => row.state === 'committed'))
        return { replayed: true as const, cursor: jobProgress(current) };
      if (rows.some((row) => row.state === 'committed'))
        conflict('Partially committed effect unit set');
      const value = await publish(tx, current);
      for (const row of rows)
        await tx
          .update(jobEffects)
          .set({ state: 'committed', updatedAt: new Date() })
          .where(eq(jobEffects.id, row.id));
      return { replayed: false as const, value };
    },
    (result) => (result.replayed ? undefined : nextProgress),
    expectedManifestHash,
  );
}
