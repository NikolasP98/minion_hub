import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { files } from '@minion-stack/db/pg';
import { invalidateTags, tags } from '@minion-stack/cache';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  metaMediaMirrorEffects,
  metaPostMedia,
  type MetaMediaMirrorEffect,
  type MetaPostMedia,
} from '$server/db/pg-meta-schema';
import { getStorage, type BlobStorageDriver } from '$server/storage/blob';
import { fetchImageSafely } from '../ssrf-guard';
import { sanitizeError } from './meta-post-media.service';
import { isMetaOwnershipLost, type MetaJobExecution } from './meta-sync-execution';

const WRITER_DEADLINE_MS = 65_000;
const CLEANUP_CAP = 5;
const CLEANUP_BACKOFF_MIN_MS = 5 * 60_000;
const CLEANUP_BACKOFF_MAX_MS = 24 * 60 * 60_000;

type FetchedImage = Awaited<ReturnType<typeof fetchImageSafely>>;

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

function cleanupBackoff(attempts: number): number {
  return Math.min(CLEANUP_BACKOFF_MAX_MS, CLEANUP_BACKOFF_MIN_MS * 2 ** Math.min(attempts, 8));
}

function fileName(postId: string, contentType: string): string {
  const extension =
    contentType
      .split('/')[1]
      ?.replace(/[^a-z0-9]/gi, '')
      .slice(0, 12) || 'img';
  return `${postId.slice(0, 100)}.${extension}`;
}

async function reserveEffect(
  execution: MetaJobExecution,
  media: MetaPostMedia,
  image: FetchedImage,
): Promise<MetaMediaMirrorEffect> {
  const imageDigest = digest(image.data);
  return execution.withOwnership(async (tx) => {
    const [currentMedia] = await tx
      .select()
      .from(metaPostMedia)
      .where(
        and(
          eq(metaPostMedia.orgId, media.orgId),
          eq(metaPostMedia.platform, media.platform),
          eq(metaPostMedia.postId, media.postId),
        ),
      )
      .for('update');
    if (!currentMedia || currentMedia.status === 'mirrored') {
      throw new Error('Meta media row is no longer mirrorable');
    }
    if (currentMedia.sourceUrl !== media.sourceUrl) {
      throw new Error('Meta media source changed during fetch');
    }

    const [active] = await tx
      .select()
      .from(metaMediaMirrorEffects)
      .where(
        and(
          eq(metaMediaMirrorEffects.orgId, media.orgId),
          eq(metaMediaMirrorEffects.platform, media.platform),
          eq(metaMediaMirrorEffects.postId, media.postId),
          eq(metaMediaMirrorEffects.state, 'active'),
        ),
      )
      .for('update');

    if (
      active?.digest === imageDigest &&
      active.fileId &&
      active.sizeBytes === image.data.byteLength &&
      active.contentType === image.contentType
    ) {
      const [reused] = await tx
        .update(metaMediaMirrorEffects)
        .set({
          sourceUrl: media.sourceUrl!,
          error: null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(eq(metaMediaMirrorEffects.id, active.id), eq(metaMediaMirrorEffects.state, 'active')),
        )
        .returning();
      if (!reused) throw new Error('Meta media effect changed during reuse');
      await tx
        .update(metaPostMedia)
        .set({
          status: 'mirroring',
          activeEffectId: reused.id,
          error: null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(metaPostMedia.orgId, media.orgId),
            eq(metaPostMedia.platform, media.platform),
            eq(metaPostMedia.postId, media.postId),
          ),
        );
      return reused;
    }

    if (active) {
      await tx
        .update(metaMediaMirrorEffects)
        .set({
          state: 'cleanup_pending',
          nextCleanupAt: sql`greatest(${metaMediaMirrorEffects.writerDeadlineAt}, clock_timestamp())`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(eq(metaMediaMirrorEffects.id, active.id), eq(metaMediaMirrorEffects.state, 'active')),
        );
    }

    const id = randomUUID();
    const fileId = id;
    const objectKey = `${media.orgId}/meta/${media.platform}/effects/${id}/${imageDigest}`;
    const [created] = await tx
      .insert(metaMediaMirrorEffects)
      .values({
        id,
        orgId: media.orgId,
        platform: media.platform,
        postId: media.postId,
        digest: imageDigest,
        sourceUrl: media.sourceUrl!,
        objectKey,
        fileId,
        sizeBytes: image.data.byteLength,
        contentType: image.contentType,
        state: 'active',
        writerDeadlineAt: sql`clock_timestamp() + (${WRITER_DEADLINE_MS} * interval '1 millisecond')`,
      })
      .returning();
    if (!created) throw new Error('Meta media effect reservation failed');

    await tx
      .update(metaPostMedia)
      .set({
        status: 'mirroring',
        activeEffectId: created.id,
        error: null,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(metaPostMedia.orgId, media.orgId),
          eq(metaPostMedia.platform, media.platform),
          eq(metaPostMedia.postId, media.postId),
        ),
      );
    return created;
  });
}

async function beginPut(execution: MetaJobExecution, effect: MetaMediaMirrorEffect): Promise<void> {
  await execution.withOwnership(async (tx) => {
    const rows = await tx
      .update(metaMediaMirrorEffects)
      .set({
        attempts: sql`${metaMediaMirrorEffects.attempts} + 1`,
        writerDeadlineAt: sql`clock_timestamp() + (${WRITER_DEADLINE_MS} * interval '1 millisecond')`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(metaMediaMirrorEffects.id, effect.id),
          eq(metaMediaMirrorEffects.orgId, effect.orgId),
          eq(metaMediaMirrorEffects.state, 'active'),
        ),
      )
      .returning({ id: metaMediaMirrorEffects.id });
    if (rows.length !== 1) throw new Error('Meta media effect is no longer active');
  });
}

async function publishEffect(
  execution: MetaJobExecution,
  effect: MetaMediaMirrorEffect,
): Promise<void> {
  await execution.withOwnership(async (tx) => {
    const [current] = await tx
      .select({ id: metaMediaMirrorEffects.id })
      .from(metaMediaMirrorEffects)
      .innerJoin(
        metaPostMedia,
        and(
          eq(metaPostMedia.orgId, metaMediaMirrorEffects.orgId),
          eq(metaPostMedia.platform, metaMediaMirrorEffects.platform),
          eq(metaPostMedia.postId, metaMediaMirrorEffects.postId),
          eq(metaPostMedia.activeEffectId, metaMediaMirrorEffects.id),
        ),
      )
      .where(
        and(
          eq(metaMediaMirrorEffects.id, effect.id),
          eq(metaMediaMirrorEffects.orgId, effect.orgId),
          eq(metaMediaMirrorEffects.state, 'active'),
        ),
      )
      .for('update');
    if (!current || !effect.fileId) throw new Error('Meta media effect is no longer publishable');

    await tx.insert(files).values({
      id: effect.fileId,
      tenantId: effect.orgId,
      uploadedBy: null,
      b2FileKey: effect.objectKey,
      fileName: fileName(effect.postId, effect.contentType),
      contentType: effect.contentType,
      sizeBytes: effect.sizeBytes,
      category: `meta/${effect.platform}`,
    });
    await tx
      .update(metaMediaMirrorEffects)
      .set({ state: 'published', error: null, updatedAt: sql`clock_timestamp()` })
      .where(
        and(eq(metaMediaMirrorEffects.id, effect.id), eq(metaMediaMirrorEffects.state, 'active')),
      );
    await tx
      .update(metaPostMedia)
      .set({
        status: 'mirrored',
        fileId: effect.fileId,
        error: null,
        fetchedAt: sql`clock_timestamp()`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(metaPostMedia.orgId, effect.orgId),
          eq(metaPostMedia.platform, effect.platform),
          eq(metaPostMedia.postId, effect.postId),
          eq(metaPostMedia.activeEffectId, effect.id),
        ),
      );
  });
}

async function recordFailure(
  execution: MetaJobExecution,
  effect: MetaMediaMirrorEffect,
  error: unknown,
): Promise<'failed' | 'published' | 'superseded'> {
  return execution.withOwnership(async (tx) => {
    const [current] = await tx
      .select({ state: metaMediaMirrorEffects.state })
      .from(metaMediaMirrorEffects)
      .where(
        and(
          eq(metaMediaMirrorEffects.id, effect.id),
          eq(metaMediaMirrorEffects.orgId, effect.orgId),
        ),
      )
      .for('update');
    if (current?.state === 'published') return 'published';
    if (current?.state !== 'active') return 'superseded';

    const message = sanitizeError(error);
    await tx
      .update(metaMediaMirrorEffects)
      .set({ error: message, updatedAt: sql`clock_timestamp()` })
      .where(
        and(eq(metaMediaMirrorEffects.id, effect.id), eq(metaMediaMirrorEffects.state, 'active')),
      );
    await tx
      .update(metaPostMedia)
      .set({
        status: 'failed',
        error: message,
        attempts: sql`${metaPostMedia.attempts} + 1`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(metaPostMedia.orgId, effect.orgId),
          eq(metaPostMedia.platform, effect.platform),
          eq(metaPostMedia.postId, effect.postId),
          eq(metaPostMedia.activeEffectId, effect.id),
        ),
      );
    return 'failed';
  });
}

/** Fetch, reserve, idempotently put, and publish one media candidate. */
export async function mirrorMediaCandidate(
  ctx: CoreCtx,
  execution: MetaJobExecution,
  media: MetaPostMedia,
  storage: BlobStorageDriver = getStorage(),
): Promise<'mirrored' | 'failed'> {
  if (!media.sourceUrl) return 'failed';
  let effect: MetaMediaMirrorEffect | null = null;
  try {
    const image = await fetchImageSafely(media.sourceUrl, execution.signal);
    effect = await reserveEffect(execution, media, image);
    const existing = await storage.head(effect.objectKey);
    if (
      !existing ||
      existing.size !== image.data.byteLength ||
      existing.contentType !== image.contentType
    ) {
      await beginPut(execution, effect);
      if (execution.signal.aborted) throw execution.signal.reason;
      await storage.put(effect.objectKey, image.data, image.contentType, {
        cacheControl: 'public, max-age=31536000, immutable',
      });
    }
    await publishEffect(execution, effect);
    try {
      await invalidateTags(tags.tenantDomain(ctx.tenantId, 'files'));
    } catch {
      // Publication is already committed. A cache outage must not turn this
      // into a false failed mirror result or schedule another object write.
      console.warn('[meta-media] cache invalidation failed (stale until TTL)');
    }
    return 'mirrored';
  } catch (error) {
    if (isMetaOwnershipLost(error) || execution.signal.aborted) throw error;
    if (effect && (await recordFailure(execution, effect, error)) === 'published') {
      // The publish transaction committed but its response was lost. Preserve
      // the durable outcome and never schedule the same object again.
      return 'mirrored';
    }
    return 'failed';
  }
}

async function cleanupCandidates(
  execution: MetaJobExecution,
  limit: number,
): Promise<MetaMediaMirrorEffect[]> {
  return execution.withOwnership(async (tx) =>
    tx
      .select()
      .from(metaMediaMirrorEffects)
      .where(
        and(
          eq(metaMediaMirrorEffects.orgId, execution.lease.orgId),
          eq(metaMediaMirrorEffects.state, 'cleanup_pending'),
          lte(metaMediaMirrorEffects.writerDeadlineAt, sql`clock_timestamp()`),
          lte(metaMediaMirrorEffects.nextCleanupAt, sql`clock_timestamp()`),
        ),
      )
      .orderBy(asc(metaMediaMirrorEffects.nextCleanupAt), asc(metaMediaMirrorEffects.id))
      .limit(limit),
  );
}

async function recordCleanupAttempt(
  execution: MetaJobExecution,
  effect: MetaMediaMirrorEffect,
  absent: boolean,
  error?: unknown,
): Promise<void> {
  await execution.withOwnership(async (tx) => {
    const delay = cleanupBackoff(effect.cleanupAttempts + 1);
    await tx
      .update(metaMediaMirrorEffects)
      .set({
        cleanupAttempts: sql`${metaMediaMirrorEffects.cleanupAttempts} + 1`,
        objectAbsentAt: absent ? sql`clock_timestamp()` : effect.objectAbsentAt,
        error: error === undefined ? null : sanitizeError(error),
        nextCleanupAt: sql`clock_timestamp() + (${delay} * interval '1 millisecond')`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(
        and(
          eq(metaMediaMirrorEffects.id, effect.id),
          eq(metaMediaMirrorEffects.orgId, effect.orgId),
          eq(metaMediaMirrorEffects.state, 'cleanup_pending'),
        ),
      );
  });
}

/** Recheck tombstones forever in a bounded, fair queue; published files are excluded by state. */
export async function reconcileMediaCleanup(
  execution: MetaJobExecution,
  storage: BlobStorageDriver = getStorage(),
  limit = CLEANUP_CAP,
): Promise<void> {
  const candidates = await cleanupCandidates(execution, Math.max(0, Math.min(limit, CLEANUP_CAP)));
  for (const effect of candidates) {
    try {
      const object = await storage.head(effect.objectKey);
      if (object) await storage.delete(effect.objectKey);
      await recordCleanupAttempt(execution, effect, true);
    } catch (error) {
      if (isMetaOwnershipLost(error) || execution.signal.aborted) throw error;
      await recordCleanupAttempt(execution, effect, false, error);
    }
  }
}
