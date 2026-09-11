import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { jobEffects } from '$server/db/pg-schema/job-effects';
import {
  jobEffectPages,
  jobEffectBatches,
  jobEffectUnits,
} from '$server/db/pg-schema/job-effect-pages';
import type { CoreTx, OrgScope } from '$server/db/with-org-core';
import type { AdvanceResult, BgJob, JobExecution } from './bg-runtime';
import {
  JobReservationOwnerError,
  jobEffectHeadId,
  withOwnedJobScope,
  type ExpectedEmbeddingProvider,
  type JobRequest,
} from './job-effects.service';
import {
  prepareEmbeddingRequest,
  executeEmbeddingRequest,
  type PreparedEmbeddingRequest,
  type EmbeddingDescriptor,
  EMBEDDING_DIMENSIONS,
} from './embeddings';

export type PageDomainGuard = (tx: CoreTx, current: BgJob) => Promise<void>;
export type PageHandle = Readonly<{ id: string; manifestHash: string }>;
export type PageUnitValue = Readonly<{
  sourceKey: string;
  chunkKey: string;
  unitId: string;
  vector: readonly number[];
}>;
export type LoadedPageSource = {
  family: string;
  entityId: string;
  sourceHash: string;
  chunks: { key: string; text: string }[];
  requiredChunkKeys: string[];
};
export type PageInput = {
  pageKey: string;
  pipelineVersion: string;
  mode: 'embedded' | 'disabled' | 'qdrant';
  expectedProvider: ExpectedEmbeddingProvider | null;
  servingGeneration: string | null;
  sources: LoadedPageSource[];
};
type ChunkDescriptor = {
  key: string;
  sourceHash: string;
  payloadHash: string;
  utf16: number;
  utf8: number;
};
type SourceDescriptor = {
  sourceKey: string;
  request: JobRequest;
  manifestHash: string;
  chunks: ChunkDescriptor[];
  requiredChunkKeys: string[];
  unitIds: string[];
};
export type PageDescriptor = {
  version: 1;
  pageKey: string;
  pipelineVersion: string;
  mode: PageInput['mode'];
  expectedProvider: ExpectedEmbeddingProvider | null;
  servingGeneration: string | null;
  policyHash: string;
  inputHash: string;
  sources: SourceDescriptor[];
};
type Progress = Record<string, unknown>;
type PageRow = typeof jobEffectPages.$inferSelect;
type UnitRow = typeof jobEffectUnits.$inferSelect;
type BatchRow = typeof jobEffectBatches.$inferSelect;
type BatchMeta = Omit<BatchRow, 'result'>;
type HeadRow = typeof jobEffects.$inferSelect;
type BatchDescriptor = EmbeddingDescriptor & { pipelineVersion: string };
const HASH = /^[a-f0-9]{64}$/;
const LIMIT = {
  heads: 64,
  units: 256,
  sourceChars: 2_097_152,
  sourceBytes: 6 * 1024 ** 2,
  descriptor: 256 * 1024,
  batchBytes: 3 * 1024 ** 2,
  preparedBytes: 12 * 1024 ** 2,
  closureUnits: 1024,
  closureHeads: 1024,
  closureBatches: 256,
  closureOwners: 256,
  closureBytes: 1024 ** 2,
  projection: 16 * 1024 ** 2,
} as const;
export class JobEffectPageError extends Error {
  constructor(
    readonly code:
      'capacity' | 'conflict' | 'superseded' | 'ownership_lost' | 'indeterminate' | 'owner_missing',
    message: string,
  ) {
    super(message);
    this.name = 'JobEffectPageError';
  }
}
class FrontierChanged extends Error {}
const conflict = (message: string): never => {
  throw new JobEffectPageError('conflict', message);
};
const capacity = (message: string): never => {
  throw new JobEffectPageError('capacity', message);
};
const superseded = (): never => {
  throw new JobEffectPageError('superseded', 'Page source was superseded');
};
const hash = (value: unknown) =>
  createHash('sha256')
    .update(
      JSON.stringify(value, (_key, item) =>
        object(item)
          ? Object.fromEntries(
              Object.keys(item)
                .sort()
                .map((key) => [key, item[key]]),
            )
          : item,
      ),
    )
    .digest('hex');
const bytes = (value: string) => Buffer.byteLength(value, 'utf8');
function bounded(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maximum &&
    !value.includes('\0') &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)
  );
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function progress(value: unknown): Progress {
  if (!object(value)) return conflict('Invalid page progress');
  return value;
}
function cursor(current: BgJob): Progress {
  try {
    return current.cursor === null ? {} : progress(JSON.parse(current.cursor));
  } catch {
    return conflict('Invalid canonical job cursor');
  }
}
function assertSignal(execution: JobExecution) {
  if (execution.signal.aborted)
    throw new JobEffectPageError('ownership_lost', 'Job ownership was cancelled');
}
function validHandle(page: PageHandle) {
  if (
    !page ||
    typeof page.id !== 'string' ||
    typeof page.manifestHash !== 'string' ||
    !HASH.test(page.id) ||
    !HASH.test(page.manifestHash)
  )
    conflict('Invalid page handle');
}
function provider(value: ExpectedEmbeddingProvider | null): ExpectedEmbeddingProvider | null {
  if (value === null) return null;
  if (
    !object(value) ||
    !bounded(value.endpoint, 512) ||
    !bounded(value.model, 128) ||
    value.normalization !== 'embedding-text-v1' ||
    value.dimensions !== EMBEDDING_DIMENSIONS
  )
    return conflict('Invalid page provider');
  return {
    endpoint: value.endpoint,
    model: value.model,
    normalization: value.normalization,
    dimensions: value.dimensions,
  };
}
function providerMatches(
  descriptor: EmbeddingDescriptor,
  expected: ExpectedEmbeddingProvider | null,
) {
  if (
    !expected ||
    descriptor.endpoint !== expected.endpoint ||
    descriptor.model !== expected.model ||
    descriptor.normalization !== expected.normalization ||
    descriptor.dimensions !== expected.dimensions
  )
    conflict('Prepared provider differs from page manifest');
}
type ValidatedInput = {
  input: PageInput;
  policyHash: string;
  inputHash: string;
  sources: {
    input: LoadedPageSource;
    sourceKey: string;
    chunks: ChunkDescriptor[];
    manifestHash: string;
  }[];
};
/** Count the complete input before making source copies or preparing provider bodies. */
// TODO(handoff): These bounds start after host source loading. Phase15 must bound source
// queries/materialization; see proposals/2026-09-08-platform-qc-remediation.md (JOB-02).
function validateInput(value: PageInput, tenantId: string): ValidatedInput {
  if (
    !object(value) ||
    !bounded(value.pageKey, 160) ||
    !bounded(value.pipelineVersion, 128) ||
    !['embedded', 'disabled', 'qdrant'].includes(value.mode) ||
    !Array.isArray(value.sources)
  )
    return conflict('Invalid page input');
  if (value.sources.length > LIMIT.heads) capacity('Page head limit exceeded');
  const expectedProvider = provider(value.expectedProvider);
  if (
    (value.mode === 'embedded' && (!expectedProvider || value.servingGeneration !== null)) ||
    (value.mode === 'disabled' &&
      (expectedProvider !== null || value.servingGeneration !== null)) ||
    (value.mode === 'qdrant' &&
      (expectedProvider !== null || !bounded(value.servingGeneration, 128)))
  )
    conflict('Invalid page mode/provider/generation');
  let count = 0,
    chars = 0,
    utf8 = 0;
  const seen = new Set<string>();
  for (const source of value.sources) {
    if (
      !object(source) ||
      !bounded(source.family, 96) ||
      !/^[a-zA-Z0-9_.:-]+$/.test(source.family) ||
      !bounded(source.entityId, 512) ||
      typeof source.sourceHash !== 'string' ||
      !HASH.test(source.sourceHash) ||
      !Array.isArray(source.chunks) ||
      !Array.isArray(source.requiredChunkKeys)
    )
      conflict('Invalid complete page source');
    const key = jobEffectHeadId(tenantId, source);
    if (seen.has(key)) conflict('Duplicate page source');
    seen.add(key);
    count += source.chunks.length;
    if (count > LIMIT.units) capacity('Complete canonical chunk limit exceeded');
    const keys = new Set<string>();
    for (const chunk of source.chunks) {
      if (!object(chunk) || !bounded(chunk.key, 160) || typeof chunk.text !== 'string')
        conflict('Invalid canonical chunk');
      if (keys.has(chunk.key)) conflict('Duplicate canonical chunk key');
      keys.add(chunk.key);
      chars += chunk.text.length;
      if (chars > LIMIT.sourceChars) capacity('Complete source UTF-16 limit exceeded');
      utf8 += bytes(chunk.text);
      if (utf8 > LIMIT.sourceBytes) capacity('Complete source UTF-8 limit exceeded');
    }
    if (
      source.requiredChunkKeys.length > source.chunks.length ||
      new Set(source.requiredChunkKeys).size !== source.requiredChunkKeys.length ||
      source.requiredChunkKeys.some((key) => typeof key !== 'string' || !keys.has(key))
    )
      conflict('Invalid original required chunk set');
  }
  const input: PageInput = {
    pageKey: value.pageKey,
    pipelineVersion: value.pipelineVersion,
    mode: value.mode,
    expectedProvider,
    servingGeneration: value.servingGeneration,
    sources: value.sources.map((s) => ({
      family: s.family,
      entityId: s.entityId,
      sourceHash: s.sourceHash,
      chunks: s.chunks.map((c) => ({ key: c.key, text: c.text })),
      requiredChunkKeys: [...s.requiredChunkKeys],
    })),
  };
  const policyHash = hash([
    input.pipelineVersion,
    input.mode,
    expectedProvider,
    input.servingGeneration,
  ]);
  const sources = input.sources.map((source) => {
    const sourceKey = jobEffectHeadId(tenantId, source);
    const chunks = source.chunks.map((chunk): ChunkDescriptor => {
      let payloadHash = hash(chunk.text);
      if (input.mode === 'embedded') {
        const prepared = prepareEmbeddingRequest([chunk.text]);
        providerMatches(prepared.descriptor, expectedProvider);
        payloadHash = prepared.descriptor.payloadHash;
      }
      return {
        key: chunk.key,
        sourceHash: hash(chunk.text),
        payloadHash,
        utf16: chunk.text.length,
        utf8: bytes(chunk.text),
      };
    });
    const manifestHash = hash([sourceKey, source.sourceHash, policyHash, chunks]);
    return { input: source, sourceKey, chunks, manifestHash };
  });
  const skeleton = {
    pageKey: input.pageKey,
    policyHash,
    sources: sources.map((s) => ({
      sourceKey: s.sourceKey,
      family: s.input.family,
      entityId: s.input.entityId,
      sourceHash: s.input.sourceHash,
      manifestHash: s.manifestHash,
      chunks: s.chunks,
      requiredChunkKeys: s.input.requiredChunkKeys,
    })),
  };
  if (bytes(JSON.stringify(skeleton)) > LIMIT.descriptor)
    capacity('Canonical page descriptor limit exceeded');
  return { input, policyHash, inputHash: hash(skeleton), sources };
}
function sourceUnitId(
  tenantId: string,
  source: SourceDescriptor,
  chunk: ChunkDescriptor,
  policyHash: string,
) {
  return hash([
    tenantId,
    source.sourceKey,
    source.request.revision,
    source.request.sourceHash,
    source.manifestHash,
    chunk.key,
    chunk.payloadHash,
    policyHash,
  ]);
}
function descriptor(row: PageRow): PageDescriptor {
  if (
    !object(row.descriptor) ||
    bytes(JSON.stringify(row.descriptor)) > LIMIT.descriptor ||
    hash(row.descriptor) !== row.manifestHash
  )
    return conflict('Invalid persisted page descriptor');
  const value = row.descriptor as unknown as PageDescriptor;
  if (
    value.version !== 1 ||
    !Array.isArray(value.sources) ||
    value.sources.length > LIMIT.heads ||
    value.pageKey !== row.pageKey ||
    !bounded(value.pipelineVersion, 128) ||
    !['embedded', 'disabled', 'qdrant'].includes(value.mode) ||
    typeof value.policyHash !== 'string' ||
    !HASH.test(value.policyHash) ||
    typeof value.inputHash !== 'string' ||
    !HASH.test(value.inputHash)
  )
    return conflict('Invalid persisted page descriptor');
  const expected = provider(value.expectedProvider);
  if (
    (value.mode === 'embedded' && (!expected || value.servingGeneration !== null)) ||
    (value.mode === 'disabled' && (expected !== null || value.servingGeneration !== null)) ||
    (value.mode === 'qdrant' && (expected !== null || !bounded(value.servingGeneration, 128)))
  )
    conflict('Invalid persisted page mode');
  if (
    hash([value.pipelineVersion, value.mode, expected, value.servingGeneration]) !==
    value.policyHash
  )
    conflict('Invalid persisted policy hash');
  let count = 0,
    utf16 = 0,
    utf8 = 0;
  const heads = new Set<string>();
  for (const source of value.sources) {
    if (
      !object(source) ||
      !object(source.request) ||
      typeof source.manifestHash !== 'string' ||
      !HASH.test(source.manifestHash) ||
      typeof source.request.revision !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        source.request.revision,
      ) ||
      typeof source.request.sourceHash !== 'string' ||
      !HASH.test(source.request.sourceHash) ||
      !Array.isArray(source.chunks) ||
      !Array.isArray(source.requiredChunkKeys) ||
      !Array.isArray(source.unitIds)
    )
      return conflict('Invalid persisted source');
    if (
      jobEffectHeadId(row.tenantId, source.request) !== source.sourceKey ||
      heads.has(source.sourceKey)
    )
      conflict('Invalid persisted head identity');
    heads.add(source.sourceKey);
    count += source.chunks.length;
    if (count > LIMIT.units) capacity('Persisted canonical chunk limit exceeded');
    const keys = new Map<string, ChunkDescriptor>();
    for (const chunk of source.chunks) {
      if (
        !object(chunk) ||
        !bounded(chunk.key, 160) ||
        keys.has(chunk.key) ||
        typeof chunk.sourceHash !== 'string' ||
        !HASH.test(chunk.sourceHash) ||
        typeof chunk.payloadHash !== 'string' ||
        !HASH.test(chunk.payloadHash) ||
        !Number.isSafeInteger(chunk.utf16) ||
        chunk.utf16 < 0 ||
        !Number.isSafeInteger(chunk.utf8) ||
        chunk.utf8 < 0
      )
        return conflict('Invalid persisted canonical chunk');
      utf16 += chunk.utf16;
      utf8 += chunk.utf8;
      keys.set(chunk.key, chunk);
      if (utf16 > LIMIT.sourceChars || utf8 > LIMIT.sourceBytes)
        capacity('Persisted source limit exceeded');
    }
    if (
      hash([source.sourceKey, source.request.sourceHash, value.policyHash, source.chunks]) !==
        source.manifestHash ||
      source.requiredChunkKeys.length !== source.unitIds.length ||
      source.requiredChunkKeys.length > source.chunks.length ||
      new Set(source.requiredChunkKeys).size !== source.requiredChunkKeys.length
    )
      conflict('Invalid persisted source manifest');
    for (let index = 0; index < source.requiredChunkKeys.length; index++) {
      const chunk = keys.get(source.requiredChunkKeys[index]!);
      if (
        !chunk ||
        source.unitIds[index] !== sourceUnitId(row.tenantId, source, chunk, value.policyHash)
      )
        conflict('Invalid persisted unit identity');
    }
  }
  return value;
}
async function pageRow(
  tx: CoreTx,
  execution: JobExecution,
  page: PageHandle,
  lock = false,
): Promise<PageRow> {
  validHandle(page);
  const query = tx
    .select()
    .from(jobEffectPages)
    .where(
      and(
        eq(jobEffectPages.id, page.id),
        eq(jobEffectPages.tenantId, execution.tenantId),
        eq(jobEffectPages.jobId, execution.jobId),
      ),
    );
  const [row] = await (lock ? query.for('update') : query);
  if (!row || row.manifestHash !== page.manifestHash)
    return conflict('Page does not match this owned job');
  descriptor(row);
  return row;
}
async function lockHeads(
  tx: CoreTx,
  tenantId: string,
  ids: string[],
): Promise<Map<string, HeadRow>> {
  const heads = new Map<string, HeadRow>();
  for (const id of [...new Set(ids)].sort()) {
    const [head] = await tx
      .select()
      .from(jobEffects)
      .where(and(eq(jobEffects.id, id), eq(jobEffects.tenantId, tenantId)))
      .for('update');
    if (!head || head.kind !== 'head') return superseded();
    heads.set(id, head);
  }
  return heads;
}
function assertSources(page: PageDescriptor, heads: Map<string, HeadRow>) {
  for (const source of page.sources) {
    const head = heads.get(source.sourceKey);
    if (
      !head ||
      head.state !== 'active' ||
      head.revision !== source.request.revision ||
      head.sourceHash !== source.request.sourceHash ||
      head.manifestHash !== source.manifestHash
    )
      superseded();
  }
}
function handle(row: PageRow): PageHandle {
  return Object.freeze({ id: row.id, manifestHash: row.manifestHash });
}

export async function loadJobEffectPage(execution: JobExecution, scope: OrgScope, pageKey: string) {
  if (!bounded(pageKey, 160)) conflict('Invalid page key');
  return withOwnedJobScope(execution, scope, async (tx) => {
    const [row] = await tx
      .select()
      .from(jobEffectPages)
      .where(
        and(
          eq(jobEffectPages.tenantId, scope.tenantId),
          eq(jobEffectPages.jobId, execution.jobId),
          eq(jobEffectPages.pageKey, pageKey),
        ),
      );
    if (!row) return { value: null };
    if (row.state !== 'bound' && row.state !== 'published') conflict('Invalid page state');
    return {
      value: {
        page: handle(row),
        state: row.state as 'bound' | 'published',
        descriptor: descriptor(row),
      },
    };
  });
}

// TODO(handoff): Corpus/worker adoption remains10-06/15-05; this foundation does not
// activate a handler. See proposals/2026-09-08-platform-qc-remediation.md (JOB-02).
export async function bindJobEffectPage(
  execution: JobExecution,
  scope: OrgScope,
  value: PageInput,
  validateDomain: PageDomainGuard,
): Promise<PageHandle> {
  if (typeof validateDomain !== 'function') conflict('Missing current source guard');
  assertSignal(execution);
  const validated = validateInput(value, scope.tenantId);
  const id = hash([scope.tenantId, execution.jobId, validated.input.pageKey]);
  return withOwnedJobScope(execution, scope, async (tx, current) => {
    const [existing] = await tx
      .select()
      .from(jobEffectPages)
      .where(and(eq(jobEffectPages.id, id), eq(jobEffectPages.tenantId, scope.tenantId)));
    if (existing) {
      const old = descriptor(existing);
      if (old.inputHash !== validated.inputHash)
        conflict('Page rebind changed complete source/required manifest');
      if (existing.state === 'published') return { value: handle(existing) };
      const heads = await lockHeads(
        tx,
        scope.tenantId,
        old.sources.map((s) => s.sourceKey),
      );
      assertSources(old, heads);
      await validateDomain(tx, current);
      await pageRow(tx, execution, handle(existing), true);
      return { value: handle(existing) };
    }
    for (const source of [...validated.sources].sort((a, b) =>
      a.sourceKey.localeCompare(b.sourceKey),
    )) {
      await tx
        .insert(jobEffects)
        .values({
          id: source.sourceKey,
          tenantId: scope.tenantId,
          family: source.input.family,
          entityId: source.input.entityId,
          kind: 'head',
          revision: randomUUID(),
          unit: '',
          sourceHash: source.input.sourceHash,
          state: 'active',
        })
        .onConflictDoNothing({ target: jobEffects.id });
    }
    const heads = await lockHeads(
      tx,
      scope.tenantId,
      validated.sources.map((s) => s.sourceKey),
    );
    await validateDomain(tx, current);
    const sources: SourceDescriptor[] = [];
    for (const source of validated.sources) {
      const head = heads.get(source.sourceKey)!;
      if (head.state !== 'active') superseded();
      let revision = head.revision;
      if (head.sourceHash !== source.input.sourceHash) {
        revision = randomUUID();
        await tx
          .update(jobEffects)
          .set({
            revision,
            sourceHash: source.input.sourceHash,
            manifestHash: source.manifestHash,
            legacyJobId: null,
            updatedAt: new Date(),
          })
          .where(eq(jobEffects.id, head.id));
      } else if (head.manifestHash === null) {
        const [history] = await tx
          .select({ id: jobEffects.id })
          .from(jobEffects)
          .where(
            and(
              eq(jobEffects.tenantId, scope.tenantId),
              eq(jobEffects.family, head.family),
              eq(jobEffects.entityId, head.entityId),
              eq(jobEffects.revision, head.revision),
              eq(jobEffects.kind, 'effect'),
            ),
          )
          .limit(1);
        // TODO(handoff): Legacy receipts cannot reconstruct a complete source manifest.
        // Select explicit10-06 reconciliation in proposals/2026-09-08-platform-qc-remediation.md (JOB-02).
        if (history) conflict('Null manifest has historical effects; explicit recovery required');
        await tx
          .update(jobEffects)
          .set({ manifestHash: source.manifestHash, updatedAt: new Date() })
          .where(eq(jobEffects.id, head.id));
      } else if (head.manifestHash !== source.manifestHash)
        conflict('Current source manifest differs');
      const captured: SourceDescriptor = {
        sourceKey: source.sourceKey,
        request: {
          family: source.input.family,
          entityId: source.input.entityId,
          revision,
          sourceHash: source.input.sourceHash,
        },
        manifestHash: source.manifestHash,
        chunks: source.chunks,
        requiredChunkKeys: source.input.requiredChunkKeys,
        unitIds: [],
      };
      captured.unitIds = captured.requiredChunkKeys.map((key) =>
        sourceUnitId(
          scope.tenantId,
          captured,
          captured.chunks.find((chunk) => chunk.key === key)!,
          validated.policyHash,
        ),
      );
      sources.push(captured);
    }
    const body: PageDescriptor = {
      version: 1,
      pageKey: validated.input.pageKey,
      pipelineVersion: validated.input.pipelineVersion,
      mode: validated.input.mode,
      expectedProvider: validated.input.expectedProvider,
      servingGeneration: validated.input.servingGeneration,
      policyHash: validated.policyHash,
      inputHash: validated.inputHash,
      sources,
    };
    const serialized = JSON.stringify(body);
    if (bytes(serialized) > LIMIT.descriptor) capacity('Captured page descriptor limit exceeded');
    // PostgreSQL JSONB adds structural spaces. Use its actual persisted representation;
    // a capacity rejection rolls back every earlier head change in this owned transaction.
    const [persisted] = await tx.execute<{ bytes: number }>(
      sql`select octet_length(${serialized}::jsonb::text) as bytes`,
    );
    if (!persisted || !Number.isSafeInteger(persisted.bytes))
      conflict('Cannot measure persisted page descriptor');
    if (persisted.bytes > LIMIT.descriptor) capacity('Persisted page descriptor limit exceeded');
    const manifestHash = hash(body);
    await tx.insert(jobEffectPages).values({
      id,
      tenantId: scope.tenantId,
      jobId: execution.jobId,
      pageKey: body.pageKey,
      manifestHash,
      descriptor: body,
      state: 'bound',
    });
    return { value: Object.freeze({ id, manifestHash }) };
  });
}

async function currentPage<T>(
  execution: JobExecution,
  scope: OrgScope,
  page: PageHandle,
  validateDomain: PageDomainGuard,
  operation: (
    tx: CoreTx,
    current: BgJob,
    row: PageRow,
    body: PageDescriptor,
  ) => Promise<{ value: T; nextProgress?: Progress }>,
) {
  if (typeof validateDomain !== 'function') conflict('Missing current source guard');
  page = { ...page };
  scope = { ...scope };
  return withOwnedJobScope<T>(execution, scope, async (tx, current) => {
    const observed = await pageRow(tx, execution, page);
    const body = descriptor(observed);
    const heads = await lockHeads(
      tx,
      scope.tenantId,
      body.sources.map((s) => s.sourceKey),
    );
    assertSources(body, heads);
    await validateDomain(tx, current);
    const row = await pageRow(tx, execution, page, true);
    return operation(tx, current, row, body);
  });
}
export function withJobEffectPage<T>(
  execution: JobExecution,
  scope: OrgScope,
  page: PageHandle,
  validateDomain: PageDomainGuard,
  operation: (tx: CoreTx, current: BgJob) => Promise<T>,
): Promise<T> {
  return currentPage(execution, scope, page, validateDomain, async (tx, current) => ({
    value: await operation(tx, current),
  }));
}
/** A page publication is not whole-job completion. The corpus adopter decides final done. */
export function jobEffectPageAdvanceResult(
  execution: JobExecution,
  scope: OrgScope,
  page: PageHandle,
): Promise<AdvanceResult> {
  return withOwnedJobScope(execution, scope, async (tx, current) => {
    const row = await pageRow(tx, execution, page);
    return {
      value: {
        done: false,
        cursor: row.state === 'published' ? progress(row.completion) : cursor(current),
      },
    };
  });
}
const batchColumns = {
  id: jobEffectBatches.id,
  tenantId: jobEffectBatches.tenantId,
  reservationJobId: jobEffectBatches.reservationJobId,
  reservationGeneration: jobEffectBatches.reservationGeneration,
  dispatchJobId: jobEffectBatches.dispatchJobId,
  dispatchGeneration: jobEffectBatches.dispatchGeneration,
  descriptor: jobEffectBatches.descriptor,
  unitIds: jobEffectBatches.unitIds,
  membershipHash: jobEffectBatches.membershipHash,
  count: jobEffectBatches.count,
  state: jobEffectBatches.state,
  abandonmentReason: jobEffectBatches.abandonmentReason,
  createdAt: jobEffectBatches.createdAt,
  updatedAt: jobEffectBatches.updatedAt,
};
function requiredUnits(body: PageDescriptor) {
  return body.sources.flatMap((source) =>
    source.requiredChunkKeys.map((key, index) => ({
      source,
      chunk: source.chunks.find((chunk) => chunk.key === key)!,
      id: source.unitIds[index]!,
    })),
  );
}
async function getUnits(tx: CoreTx, tenantId: string, ids: string[], lock = false) {
  if (!ids.length) return [];
  const query = tx
    .select()
    .from(jobEffectUnits)
    .where(
      and(
        eq(jobEffectUnits.tenantId, tenantId),
        inArray(jobEffectUnits.id, [...new Set(ids)].sort()),
      ),
    )
    .orderBy(jobEffectUnits.id)
    .limit(LIMIT.closureUnits + 1);
  return lock ? query.for('update') : query;
}
async function getBatches(
  tx: CoreTx,
  tenantId: string,
  ids: string[],
  lock = false,
): Promise<BatchMeta[]> {
  if (!ids.length) return [];
  const query = tx
    .select(batchColumns)
    .from(jobEffectBatches)
    .where(
      and(
        eq(jobEffectBatches.tenantId, tenantId),
        inArray(jobEffectBatches.id, [...new Set(ids)].sort()),
      ),
    )
    .orderBy(jobEffectBatches.id)
    .limit(LIMIT.closureBatches + 1);
  return lock ? query.for('update') : query;
}
type Frontier = {
  units: UnitRow[];
  batches: BatchMeta[];
  heads: string[];
  owners: { jobId: string; reservationGeneration: number }[];
  fingerprint: string;
};
/** Metadata only: never load complete stored vector batches to discover overlap. */
async function discover(tx: CoreTx, tenantId: string, body: PageDescriptor): Promise<Frontier> {
  const required = requiredUnits(body);
  if (required.length > LIMIT.units) capacity('Required unit limit exceeded');
  const selected = await getUnits(
    tx,
    tenantId,
    required.map((unit) => unit.id),
  );
  const batches = await getBatches(
    tx,
    tenantId,
    selected.flatMap((unit) => (unit.batchId ? [unit.batchId] : [])),
  );
  if (batches.length > LIMIT.closureBatches) capacity('Foreign batch closure exceeded');
  const byId = new Map(batches.map((batch) => [batch.id, batch]));
  for (const unit of selected) {
    if (unit.batchId && !byId.has(unit.batchId))
      conflict('Unit placement references missing batch');
  }
  const reserved = batches.filter((batch) => batch.state === 'reserved');
  // A complete membership snapshot is bounded before fetching companion metadata.
  const companionIds = new Set(selected.map((unit) => unit.id));
  for (const batch of reserved) {
    if (
      !Array.isArray(batch.unitIds) ||
      batch.unitIds.length !== batch.count ||
      batch.count < 1 ||
      batch.count > 64
    )
      conflict('Invalid reserved membership');
    for (const id of batch.unitIds) companionIds.add(id);
    if (companionIds.size > LIMIT.closureUnits) capacity('Foreign unit closure exceeded');
  }
  const units = await getUnits(tx, tenantId, [...companionIds]);
  if (units.length > LIMIT.closureUnits) capacity('Foreign unit closure exceeded');
  const heads = [
    ...new Set([
      ...body.sources.map((source) => source.sourceKey),
      ...units
        .filter((unit) => unit.batchId && reserved.some((batch) => batch.id === unit.batchId))
        .map((unit) => unit.headId),
    ]),
  ].sort();
  if (heads.length > LIMIT.closureHeads) capacity('Foreign head closure exceeded');
  const owners = [
    ...new Map(
      reserved.map((batch) => [
        `${batch.reservationJobId}:${batch.reservationGeneration}`,
        { jobId: batch.reservationJobId, reservationGeneration: batch.reservationGeneration },
      ]),
    ).values(),
  ];
  if (owners.length > LIMIT.closureOwners) capacity('Foreign owner closure exceeded');
  const observation = { units, batches, heads, owners };
  if (bytes(JSON.stringify(observation)) > LIMIT.closureBytes)
    capacity('Foreign metadata closure exceeded');
  return { ...observation, fingerprint: hash(observation) };
}
function assertUnit(
  unit: UnitRow,
  required: ReturnType<typeof requiredUnits>[number],
  body: PageDescriptor,
) {
  if (
    unit.id !== required.id ||
    unit.headId !== required.source.sourceKey ||
    unit.headKind !== 'head' ||
    unit.revision !== required.source.request.revision ||
    unit.sourceHash !== required.source.request.sourceHash ||
    unit.manifestHash !== required.source.manifestHash ||
    unit.chunkKey !== required.chunk.key ||
    unit.payloadHash !== required.chunk.payloadHash ||
    unit.policyHash !== body.policyHash
  )
    conflict('Semantic unit identity mismatch');
}
function preparedBatch(
  texts: string[],
  body: PageDescriptor,
): { request: PreparedEmbeddingRequest; descriptor: BatchDescriptor; size: number } {
  const request = prepareEmbeddingRequest(texts);
  providerMatches(request.descriptor, body.expectedProvider);
  // Existing preparation owns dispatch. Reconstruct only its documented serialization to
  // prove the byte budget; compare its digest so a changed preparation cannot pass silently.
  const serialized = JSON.stringify({
    model: request.descriptor.model,
    input: texts.map((text) => text.slice(0, 8000)),
  });
  const payloadHash = createHash('sha256').update(serialized).digest('hex');
  if (payloadHash !== request.descriptor.payloadHash)
    conflict('Prepared request serialization contract changed');
  const size = bytes(serialized);
  if (size > LIMIT.batchBytes) capacity('Prepared batch byte limit exceeded');
  return {
    request,
    descriptor: { ...request.descriptor, pipelineVersion: body.pipelineVersion },
    size,
  };
}
type DispatchBatch = {
  id: string;
  unitIds: string[];
  membershipHash: string;
  request: PreparedEmbeddingRequest;
  descriptor: BatchDescriptor;
};
function loadedTexts(body: PageDescriptor, loaded: readonly LoadedPageSource[], tenantId: string) {
  const validated = validateInput(
    {
      pageKey: body.pageKey,
      pipelineVersion: body.pipelineVersion,
      mode: body.mode,
      expectedProvider: body.expectedProvider,
      servingGeneration: body.servingGeneration,
      sources: [...loaded],
    },
    tenantId,
  );
  if (validated.inputHash !== body.inputHash || validated.policyHash !== body.policyHash)
    superseded();
  const texts = new Map<string, string>();
  for (const source of body.sources) {
    const value = validated.sources.find((item) => item.sourceKey === source.sourceKey);
    if (!value || value.manifestHash !== source.manifestHash) superseded();
    for (let index = 0; index < source.requiredChunkKeys.length; index++) {
      const key = source.requiredChunkKeys[index]!;
      texts.set(
        source.unitIds[index]!,
        value!.input.chunks.find((chunk) => chunk.key === key)!.text,
      );
    }
  }
  return texts;
}
async function reserve(
  execution: JobExecution,
  scope: OrgScope,
  page: PageHandle,
  body: PageDescriptor,
  observed: Frontier,
  texts: Map<string, string>,
  validateDomain: PageDomainGuard,
): Promise<DispatchBatch[]> {
  return withOwnedJobScope(
    execution,
    scope,
    async (tx, current) => {
      const heads = await lockHeads(tx, scope.tenantId, observed.heads);
      assertSources(body, heads);
      await validateDomain(tx, current);
      const row = await pageRow(tx, execution, page, true);
      if (row.state === 'published') return { value: [] };
      await getBatches(
        tx,
        scope.tenantId,
        observed.batches.map((batch) => batch.id),
        true,
      );
      await getUnits(
        tx,
        scope.tenantId,
        observed.units.map((unit) => unit.id),
        true,
      );
      const actual = await discover(tx, scope.tenantId, body);
      if (actual.fingerprint !== observed.fingerprint) throw new FrontierChanged();
      if (actual.batches.some((batch) => batch.state === 'admitted'))
        throw new JobEffectPageError(
          'indeterminate',
          'Page overlaps an admitted effect without a response',
        );
      const required = requiredUnits(body);
      const unitMap = new Map(actual.units.map((unit) => [unit.id, unit]));
      const batchMap = new Map(actual.batches.map((batch) => [batch.id, batch]));
      for (const item of required) {
        const existing = unitMap.get(item.id);
        if (existing) assertUnit(existing, item, body);
      }
      const dispatch: DispatchBatch[] = [];
      let preparedSize = 0;
      const handled = new Set<string>();
      for (const batch of actual.batches) {
        if (batch.state !== 'reserved') continue;
        const members = batch.unitIds.map((id) => unitMap.get(id));
        if (members.some((member) => !member || member.batchId !== batch.id))
          conflict('Incomplete reservation companion closure');
        const complete = batch.unitIds.every((id) => texts.has(id));
        if (complete) {
          const prepared = preparedBatch(
            batch.unitIds.map((id) => texts.get(id)!),
            body,
          );
          preparedSize += prepared.size;
          if (preparedSize > LIMIT.preparedBytes)
            capacity('Complete prepared page byte limit exceeded');
          if (
            hash(prepared.descriptor) !== hash(batch.descriptor) ||
            hash(batch.unitIds) !== batch.membershipHash
          )
            conflict('Reserved request descriptor mismatch');
          const [transferred] = await tx
            .update(jobEffectBatches)
            .set({
              reservationJobId: execution.jobId,
              reservationGeneration: execution.leaseGeneration,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(jobEffectBatches.id, batch.id),
                eq(jobEffectBatches.tenantId, scope.tenantId),
                eq(jobEffectBatches.state, 'reserved'),
                eq(jobEffectBatches.reservationJobId, batch.reservationJobId),
                eq(jobEffectBatches.reservationGeneration, batch.reservationGeneration),
              ),
            )
            .returning({ id: jobEffectBatches.id });
          if (!transferred) throw new FrontierChanged();
          dispatch.push({
            id: batch.id,
            unitIds: batch.unitIds,
            membershipHash: batch.membershipHash,
            request: prepared.request,
            descriptor: prepared.descriptor,
          });
          batch.unitIds.forEach((id) => handled.add(id));
        } else {
          const [abandoned] = await tx
            .update(jobEffectBatches)
            .set({
              state: 'abandoned_unsent',
              abandonmentReason: 'current_page_requires_different_members',
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(jobEffectBatches.id, batch.id),
                eq(jobEffectBatches.tenantId, scope.tenantId),
                eq(jobEffectBatches.state, 'reserved'),
                eq(jobEffectBatches.reservationJobId, batch.reservationJobId),
                eq(jobEffectBatches.reservationGeneration, batch.reservationGeneration),
              ),
            )
            .returning({ id: jobEffectBatches.id });
          if (!abandoned) throw new FrontierChanged();
          await tx
            .update(jobEffectUnits)
            .set({ batchId: null, vectorIndex: null })
            .where(
              and(
                eq(jobEffectUnits.tenantId, scope.tenantId),
                eq(jobEffectUnits.batchId, batch.id),
              ),
            );
          for (const member of members) {
            member!.batchId = null;
            member!.vectorIndex = null;
          }
        }
      }
      const missing = required.filter((item) => {
        if (handled.has(item.id)) return false;
        const existing = unitMap.get(item.id);
        if (!existing?.batchId) return true;
        const batch = batchMap.get(existing.batchId);
        if (batch?.state !== 'received') conflict('Unexpected semantic unit placement');
        return false;
      });
      for (const item of missing) {
        if (unitMap.has(item.id)) continue;
        await tx.insert(jobEffectUnits).values({
          id: item.id,
          tenantId: scope.tenantId,
          headId: item.source.sourceKey,
          headKind: 'head',
          revision: item.source.request.revision,
          sourceHash: item.source.request.sourceHash,
          manifestHash: item.source.manifestHash,
          chunkKey: item.chunk.key,
          payloadHash: item.chunk.payloadHash,
          policyHash: body.policyHash,
        });
      }
      for (let index = 0; index < missing.length; index += 64) {
        const items = missing.slice(index, index + 64);
        const unitIds = items.map((item) => item.id);
        const prepared = preparedBatch(
          unitIds.map((id) => texts.get(id)!),
          body,
        );
        preparedSize += prepared.size;
        if (preparedSize > LIMIT.preparedBytes)
          capacity('Complete prepared page byte limit exceeded');
        const id = hash(randomUUID()),
          membershipHash = hash(unitIds);
        await tx.insert(jobEffectBatches).values({
          id,
          tenantId: scope.tenantId,
          reservationJobId: execution.jobId,
          reservationGeneration: execution.leaseGeneration,
          descriptor: prepared.descriptor,
          unitIds,
          membershipHash,
          count: unitIds.length,
          state: 'reserved',
        });
        for (let position = 0; position < unitIds.length; position++) {
          await tx
            .update(jobEffectUnits)
            .set({ batchId: id, vectorIndex: position })
            .where(
              and(
                eq(jobEffectUnits.id, unitIds[position]!),
                eq(jobEffectUnits.tenantId, scope.tenantId),
              ),
            );
        }
        dispatch.push({
          id,
          unitIds,
          membershipHash,
          request: prepared.request,
          descriptor: prepared.descriptor,
        });
      }
      return { value: dispatch };
    },
    { foreignReservationOwners: observed.owners },
  );
}

async function dispatchOne(
  execution: JobExecution,
  scope: OrgScope,
  page: PageHandle,
  batch: DispatchBatch,
  validateDomain: PageDomainGuard,
) {
  assertSignal(execution);
  // Resolving this outer transaction is the only source of one-use permission.
  const permitted = await currentPage(
    execution,
    scope,
    page,
    validateDomain,
    async (tx, _current, row, body) => {
      if (row.state === 'published') return { value: false };
      const [current] = await getBatches(tx, scope.tenantId, [batch.id], true);
      if (
        !current ||
        current.state !== 'reserved' ||
        current.reservationJobId !== execution.jobId ||
        current.reservationGeneration !== execution.leaseGeneration
      ) {
        if (current?.state === 'admitted')
          throw new JobEffectPageError('indeterminate', 'Dispatch admission already exists');
        throw new FrontierChanged();
      }
      if (
        hash(current.descriptor) !== hash(batch.descriptor) ||
        current.membershipHash !== batch.membershipHash ||
        hash(current.unitIds) !== hash(batch.unitIds)
      )
        conflict('Dispatch descriptor changed');
      const members = await getUnits(tx, scope.tenantId, batch.unitIds, true);
      const required = new Map(requiredUnits(body).map((unit) => [unit.id, unit]));
      if (members.length !== batch.unitIds.length) conflict('Dispatch membership incomplete');
      for (const member of members) {
        const expected = required.get(member.id);
        if (
          !expected ||
          member.batchId !== batch.id ||
          member.vectorIndex !== batch.unitIds.indexOf(member.id)
        )
          return conflict('Dispatch membership changed');
        assertUnit(member, expected, body);
      }
      assertSignal(execution);
      const [admitted] = await tx
        .update(jobEffectBatches)
        .set({
          state: 'admitted',
          dispatchJobId: execution.jobId,
          dispatchGeneration: execution.leaseGeneration,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(jobEffectBatches.id, batch.id),
            eq(jobEffectBatches.tenantId, scope.tenantId),
            eq(jobEffectBatches.state, 'reserved'),
            eq(jobEffectBatches.reservationJobId, execution.jobId),
            eq(jobEffectBatches.reservationGeneration, execution.leaseGeneration),
          ),
        )
        .returning({ id: jobEffectBatches.id });
      if (!admitted) throw new FrontierChanged();
      return { value: true };
    },
  );
  if (!permitted) return;
  // TODO(handoff): A commit-to-call gap can leave an admitted request unsent. Preserve
  // indeterminate evidence; select explicit recovery in proposals/2026-09-08-platform-qc-remediation.md (JOB-02).
  assertSignal(execution);
  // TODO(handoff): The existing provider JSON reader is not byte bounded before res.json();
  // phase15 owns that limit. See proposals/2026-09-08-platform-qc-remediation.md (JOB-02).
  const result = await executeEmbeddingRequest(batch.request, {
    signal: execution.signal,
    attemptPolicy: 'single',
  });
  if (
    result.length !== batch.unitIds.length ||
    result.some(
      (vector) =>
        vector.length !== EMBEDDING_DIMENSIONS ||
        Array.from(vector).some(
          (component) => typeof component !== 'number' || !Number.isFinite(component),
        ),
    )
  )
    conflict('Invalid complete provider result');
  // Historical response retention checks dispatch ownership, not current member heads.
  await withOwnedJobScope(execution, scope, async (tx) => {
    const [current] = await getBatches(tx, scope.tenantId, [batch.id], true);
    if (
      !current ||
      current.state !== 'admitted' ||
      current.dispatchJobId !== execution.jobId ||
      current.dispatchGeneration !== execution.leaseGeneration ||
      current.membershipHash !== batch.membershipHash ||
      hash(current.descriptor) !== hash(batch.descriptor) ||
      hash(current.unitIds) !== hash(batch.unitIds)
    )
      conflict('Original dispatch ownership or descriptor changed');
    const [received] = await tx
      .update(jobEffectBatches)
      .set({ state: 'received', result, updatedAt: new Date() })
      .where(
        and(
          eq(jobEffectBatches.id, batch.id),
          eq(jobEffectBatches.tenantId, scope.tenantId),
          eq(jobEffectBatches.state, 'admitted'),
          eq(jobEffectBatches.dispatchJobId, execution.jobId),
          eq(jobEffectBatches.dispatchGeneration, execution.leaseGeneration),
        ),
      )
      .returning({ id: jobEffectBatches.id });
    if (!received) conflict('Response retention transition lost');
    return { value: undefined };
  });
}
export async function runJobPageEmbeddings(
  execution: JobExecution,
  scope: OrgScope,
  page: PageHandle,
  sources: readonly LoadedPageSource[],
  validateDomain: PageDomainGuard,
): Promise<
  | { state: 'ready' }
  | { state: 'busy'; reason: 'owner_busy' | 'frontier_changed'; advance: AdvanceResult }
> {
  page = { ...page };
  scope = { ...scope };
  assertSignal(execution);
  const initial = await withOwnedJobScope(execution, scope, async (tx) => ({
    value: await pageRow(tx, execution, page),
  }));
  if (initial.state === 'published') return { state: 'ready' };
  const body = descriptor(initial);
  const texts = loadedTexts(body, sources, scope.tenantId);
  if (body.mode !== 'embedded' || requiredUnits(body).length === 0) {
    await withJobEffectPage(execution, scope, page, validateDomain, async () => undefined);
    return { state: 'ready' };
  }
  try {
    const observed = await withOwnedJobScope(execution, scope, async (tx) => ({
      value: await discover(tx, scope.tenantId, body),
    }));
    if (observed.batches.some((batch) => batch.state === 'admitted'))
      throw new JobEffectPageError(
        'indeterminate',
        'Page overlaps an admitted effect without a response',
      );
    const batches = await reserve(execution, scope, page, body, observed, texts, validateDomain);
    let index = 0;
    let stopped = false;
    const errors: unknown[] = [];
    const workers = Array.from({ length: Math.min(4, batches.length) }, async () => {
      while (!stopped && !execution.signal.aborted) {
        const batch = batches[index++];
        if (!batch) return;
        try {
          await dispatchOne(execution, scope, page, batch, validateDomain);
        } catch (error) {
          stopped = true;
          errors.push(error);
        }
      }
    });
    await Promise.all(workers); // Every already-started attempt is observed before returning.
    if (errors.length) throw errors[0];
    assertSignal(execution);
    await currentPage(
      execution,
      scope,
      page,
      validateDomain,
      async (tx, _current, row, currentBody) => {
        if (row.state !== 'published') {
          const frontier = await discover(tx, scope.tenantId, currentBody);
          if (
            frontier.units.filter(
              (unit) =>
                unit.batchId !== null &&
                requiredUnits(currentBody).some((item) => item.id === unit.id),
            ).length !== requiredUnits(currentBody).length ||
            frontier.batches.some((batch) => batch.state !== 'received')
          )
            conflict('Page embeddings are not complete');
        }
        return { value: undefined };
      },
    );
    return { state: 'ready' };
  } catch (error) {
    if (error instanceof JobReservationOwnerError && error.code === 'capacity')
      throw new JobEffectPageError('capacity', error.message);
    if (error instanceof JobReservationOwnerError && error.code === 'owner_missing') {
      // TODO(handoff): Missing historical owner needs explicit recovery, not endless busy
      // retries or invented invalidation. See proposals/2026-09-08-platform-qc-remediation.md (JOB-02).
      throw new JobEffectPageError(
        'owner_missing',
        'Historical reservation owner missing; recovery required',
      );
    }
    if (error instanceof FrontierChanged || error instanceof JobReservationOwnerError) {
      return {
        state: 'busy',
        reason: error instanceof FrontierChanged ? 'frontier_changed' : 'owner_busy',
        advance: await jobEffectPageAdvanceResult(execution, scope, page),
      };
    }
    throw error;
  }
}

/** SQL returns selected indices only, and scalar rejection before oversized payload return. */
async function projectedValues(
  tx: CoreTx,
  tenantId: string,
  body: PageDescriptor,
): Promise<PageUnitValue[]> {
  const required = requiredUnits(body);
  if (!required.length || body.mode !== 'embedded') return [];
  if (required.length > LIMIT.units) capacity('Projection unit limit exceeded');
  const selected = sql.join(
    required.map(
      (item, ordinal) =>
        sql`(${item.id}::text, ${item.source.sourceKey}::text, ${item.chunk.key}::text, ${ordinal}::integer)`,
    ),
    sql`, `,
  );
  const [row] = await tx.execute<{
    total_bytes: string | number;
    count: number;
    payload: string | null;
  }>(sql`
    WITH required(id, source_key, chunk_key, ordinal) AS (VALUES ${selected}),
    projected AS MATERIALIZED (
      SELECT r.ordinal, jsonb_build_object('sourceKey',r.source_key,'chunkKey',r.chunk_key,'unitId',r.id,
        'vector',b.result->u.vector_index)::text AS payload
      FROM required r JOIN job_effect_units u ON u.id=r.id AND u.tenant_id=${tenantId}
      JOIN job_effect_batches b ON b.id=u.batch_id AND b.tenant_id=u.tenant_id AND b.state='received'
    ), sizes AS (
      SELECT coalesce(sum(octet_length(payload)),0)+greatest(count(*)-1,0)+2 AS total_bytes, count(*)::integer AS count FROM projected
    ) SELECT total_bytes, count, CASE WHEN total_bytes<=${LIMIT.projection}
      THEN (SELECT '['||coalesce(string_agg(payload,',' ORDER BY ordinal),'')||']' FROM projected)
      ELSE NULL END AS payload FROM sizes`);
  if (!row || Number(row.total_bytes) > LIMIT.projection || row.payload === null)
    return capacity('Selected vector projection exceeds byte limit');
  if (typeof row.payload !== 'string' || bytes(row.payload) > LIMIT.projection)
    capacity('Returned projection exceeds byte limit');
  if (Number(row.total_bytes) !== bytes(row.payload) || row.count !== required.length)
    conflict('Selected projection is incomplete');
  const value: unknown = JSON.parse(row.payload);
  if (!Array.isArray(value) || value.length !== required.length)
    return conflict('Invalid selected projection');
  let canonicalBytes = 2;
  for (let index = 0; index < required.length; index++) {
    const item = value[index] as unknown;
    const expected = required[index]!;
    if (
      !object(item) ||
      item.unitId !== expected.id ||
      item.sourceKey !== expected.source.sourceKey ||
      item.chunkKey !== expected.chunk.key ||
      !Array.isArray(item.vector) ||
      item.vector.length !== EMBEDDING_DIMENSIONS ||
      item.vector.some((number) => typeof number !== 'number' || !Number.isFinite(number))
    )
      conflict('Invalid selected vector');
    canonicalBytes += bytes(JSON.stringify(item)) + (index ? 1 : 0);
    if (canonicalBytes > LIMIT.projection)
      capacity('Canonical selected projection exceeds byte limit');
  }
  return value as PageUnitValue[];
}
export async function commitJobEffectPage<T>(
  execution: JobExecution,
  scope: OrgScope,
  page: PageHandle,
  validateDomain: PageDomainGuard,
  publish: (tx: CoreTx, current: BgJob, values: readonly PageUnitValue[]) => Promise<T>,
  nextProgress: Progress,
): Promise<{ replayed: false; value: T } | { replayed: true }> {
  page = { ...page };
  scope = { ...scope };
  if (typeof validateDomain !== 'function' || typeof publish !== 'function')
    conflict('Missing page publication guard/callback');
  const completion = progress(JSON.parse(JSON.stringify(progress(nextProgress))));
  return withOwnedJobScope<{ replayed: false; value: T } | { replayed: true }>(
    execution,
    scope,
    async (tx, current) => {
      const observed = await pageRow(tx, execution, page);
      // Published replay suppresses only this page callback; never assert whole-job done.
      if (observed.state === 'published') return { value: { replayed: true as const } };
      const body = descriptor(observed);
      const heads = await lockHeads(
        tx,
        scope.tenantId,
        body.sources.map((source) => source.sourceKey),
      );
      assertSources(body, heads);
      await validateDomain(tx, current);
      const row = await pageRow(tx, execution, page, true);
      if (row.state === 'published') return { value: { replayed: true as const } };
      const required = requiredUnits(body);
      if (body.mode === 'embedded' && required.length) {
        const found = await getUnits(
          tx,
          scope.tenantId,
          required.map((item) => item.id),
        );
        const batchIds = found.flatMap((unit) => (unit.batchId ? [unit.batchId] : []));
        await getBatches(tx, scope.tenantId, batchIds, true);
        const units = await getUnits(
          tx,
          scope.tenantId,
          required.map((item) => item.id),
          true,
        );
        if (units.length !== required.length) conflict('Missing page publication units');
        const byId = new Map(units.map((unit) => [unit.id, unit]));
        for (const item of required) assertUnit(byId.get(item.id)!, item, body);
      }
      const values = await projectedValues(tx, scope.tenantId, body);
      const value = await publish(tx, current, values);
      if (body.mode === 'embedded' && required.length)
        await tx
          .update(jobEffectUnits)
          .set({ firstPublishedAt: new Date() })
          .where(
            and(
              eq(jobEffectUnits.tenantId, scope.tenantId),
              inArray(
                jobEffectUnits.id,
                required.map((item) => item.id),
              ),
              sql`${jobEffectUnits.firstPublishedAt} IS NULL`,
            ),
          );
      await tx
        .update(jobEffectPages)
        .set({ state: 'published', completion, updatedAt: new Date() })
        .where(
          and(
            eq(jobEffectPages.id, page.id),
            eq(jobEffectPages.tenantId, scope.tenantId),
            eq(jobEffectPages.state, 'bound'),
          ),
        );
      return { value: { replayed: false as const, value }, nextProgress: completion };
    },
  );
}
