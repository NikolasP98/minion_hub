import { and, eq, lt, notExists, sql } from 'drizzle-orm';
import { files } from '@minion-stack/db/pg';
import { invalidateTags, tags } from '@minion-stack/cache';
import { newId } from '$server/db/utils';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { getStorage } from '$server/storage/blob';
import { recordAuditInTx } from './activity.service';
import { ATTACHMENT_LIMITS, validateAttachment, assertOrgQuota } from './file.service';
import { attachmentLinks, type AttachmentObjectType } from '$server/db/pg-attachments-schema';
import type { CoreCtx } from '$server/auth/core-ctx';

export { ATTACHMENT_OBJECT_MODULE, AttachmentError } from './attachment-access';
export type { AttachmentObjectRef, Actor, AttachmentErrorCode } from './attachment-access';
import {
  AttachmentError,
  ATTACHMENT_OBJECT_MODULE,
  requireAccessIdentity,
  requireAnyAttachmentCapability,
  requireAttachmentObject,
  lockAttachmentObjectsInTx,
  type AttachmentAccess,
  type AttachmentObjectRef,
  type Actor,
} from './attachment-access';
import {
  withLockedAttachmentFile,
  requireActiveFile,
  registerAttachmentInTx,
  requireReadableAttachmentFile,
  visibleLinksInTx,
  deleteManagedAttachment,
  claimDeletionInTx,
  finishAttachmentDeletion,
} from './attachment-lifecycle';
import { attachmentFileState } from '$server/db/pg-attachments-schema';

async function linkInTx(
  tx: CoreTx,
  ctx: CoreCtx,
  fileId: string,
  ref: AttachmentObjectRef,
  actor: Actor,
): Promise<void> {
  await tx
    .insert(attachmentLinks)
    .values({
      orgId: ctx.tenantId,
      fileId,
      objectType: ref.objectType,
      objectId: ref.objectId,
      linkedBy: actor.id,
    })
    .onConflictDoNothing();
  await recordAuditInTx(tx, ctx, {
    refType: ref.objectType,
    refId: ref.objectId,
    op: 'attachment.link',
    changes: [{ field: 'fileId', label: 'Attachment', old: null, new: fileId }],
    actor,
  });
}

export interface CreateUploadIntentInput {
  fileName: string;
  contentType: string;
  sizeBytes: number;
  category?: string;
  uploadedBy?: string | null;
  links?: AttachmentObjectRef[];
}

export interface UploadIntent {
  fileId: string;
  key: string;
  uploadUrl: string;
  maxBytes: number;
}

/** Validate + reserve a `files` row, then hand back a presigned PUT url. The
 *  object may never actually land (abandoned upload) — `finalizeUpload`
 *  cleans up the row when the storage HEAD comes back empty; `sweepAbandonedUploads`
 *  below reaps rows where the browser closed before `finalizeUpload` ever ran. */
async function reserveAttachmentUpload(
  ctx: CoreCtx,
  input: CreateUploadIntentInput,
  access: AttachmentAccess,
  presigned = false,
) {
  requireAccessIdentity(ctx, access);
  requireAnyAttachmentCapability(access, 'edit');
  const validation = validateAttachment(input);
  if (!validation.ok) throw new AttachmentError(validation.code, validation.message);
  const quota = await assertOrgQuota(ctx, input.sizeBytes);
  if (!quota.ok) throw new AttachmentError(quota.code, quota.message);

  const id = newId();
  const category = 'attachment';
  const key = `${ctx.tenantId}/attachments/${id}/${input.fileName}`;

  await withOrgCore(ctx, async (tx) => {
    await lockAttachmentObjectsInTx(tx, ctx, input.links ?? []);
    for (const ref of input.links ?? [])
      await requireAttachmentObject(tx, ctx, access, ref, 'edit');
    await tx.insert(files).values({
      id,
      tenantId: ctx.tenantId,
      uploadedBy: access.profileId,
      b2FileKey: key,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      category,
    });
    // Untyped uploads are explicit personal staging: retain only modules the
    // uploader can edit now. Record upload callers must pass their known targets.
    const accessModules = input.links?.length
      ? [...new Set(input.links.map((ref) => ATTACHMENT_OBJECT_MODULE[ref.objectType]))]
      : Object.entries(access.modules)
          .filter(([, cap]) => cap.view && cap.edit)
          .map(([module]) => module);
    await tx.insert(attachmentFileState).values({
      fileId: id,
      orgId: ctx.tenantId,
      fileKey: key,
      accessModules,
      uploadExpiresAt: presigned ? new Date(Date.now() + 900_000) : null,
    });
  });

  return { fileId: id, key, maxBytes: ATTACHMENT_LIMITS.maxFileBytes };
}

export async function createUploadIntent(
  ctx: CoreCtx,
  input: CreateUploadIntentInput,
  access: AttachmentAccess,
): Promise<UploadIntent> {
  const reserved = await reserveAttachmentUpload(ctx, input, access, true);
  const uploadUrl = await getStorage().presignPut(reserved.key, input.contentType, 900, {
    contentLength: input.sizeBytes,
  });
  // Persist a conservative deadline after signing and before exposing the URL.
  // If deletion won during signing, no write capability is returned to the caller.
  await withLockedAttachmentFile(ctx, reserved.fileId, [], async (tx, locked) => {
    requireActiveFile(locked);
    await tx
      .update(attachmentFileState)
      .set({ uploadExpiresAt: new Date(Date.now() + 900_000) })
      .where(
        and(
          eq(attachmentFileState.fileId, reserved.fileId),
          eq(attachmentFileState.orgId, ctx.tenantId),
        ),
      );
  });
  return { ...reserved, uploadUrl };
}

/** The fallback reserves with the same target authority before touching storage.
 * A failed/uncertain PUT leaves a durable unlinked reservation for the sweeper. */
export async function uploadProxiedAttachment(
  ctx: CoreCtx,
  input: CreateUploadIntentInput & { data: Uint8Array },
  access: AttachmentAccess,
) {
  const reserved = await reserveAttachmentUpload(
    ctx,
    { ...input, sizeBytes: input.data.byteLength },
    access,
  );
  await getStorage().put(reserved.key, input.data, input.contentType);
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'files'));
  return reserved.fileId;
}

export interface FinalizeUploadInput {
  fileId: string;
  links?: AttachmentObjectRef[];
  actor?: Actor;
}

/** Confirm the presigned PUT landed, correct `size_bytes` to the real object
 *  size, and create any requested links — all in one transaction. */
export async function finalizeUpload(
  ctx: CoreCtx,
  input: FinalizeUploadInput,
  access: AttachmentAccess,
) {
  requireAccessIdentity(ctx, access);
  requireAnyAttachmentCapability(access, 'edit');
  const actor: Actor = input.actor ?? { id: access.profileId, name: null };
  const links = input.links ?? [];
  const authorize = async (
    tx: CoreTx,
    locked: Parameters<Parameters<typeof withLockedAttachmentFile>[3]>[1],
  ) => {
    requireActiveFile(locked);
    // Finalize changes metadata and may reject/delete a malformed upload, so
    // sharing a readable file does not confer uploader authority.
    if (locked.file.uploadedBy !== access.profileId)
      throw new AttachmentError('not_found', 'file not found');
    await requireReadableAttachmentFile(tx, ctx, access, locked);
    for (const ref of [...locked.refs, ...links])
      await requireAttachmentObject(tx, ctx, access, ref, 'edit');
  };
  const key = await withLockedAttachmentFile(ctx, input.fileId, links, async (tx, locked) => {
    await authorize(tx, locked);
    return locked.file.b2FileKey;
  });
  const head = await getStorage().head(key);
  if (!head || head.size > ATTACHMENT_LIMITS.maxFileBytes) {
    const claimed = await withLockedAttachmentFile(ctx, input.fileId, links, async (tx, locked) => {
      await authorize(tx, locked);
      if (locked.refs.length) return false;
      await claimDeletionInTx(tx, ctx, locked, access.profileId);
      return true;
    });
    if (claimed) await finishAttachmentDeletion(ctx, input.fileId, key);
    throw new AttachmentError(
      head ? 'too_large' : 'upload_missing',
      head ? 'uploaded object exceeds attachment limit' : 'uploaded object not found in storage',
    );
  }
  await withLockedAttachmentFile(ctx, input.fileId, links, async (tx, locked) => {
    await authorize(tx, locked);
    await registerAttachmentInTx(tx, ctx, locked, [...locked.refs, ...links]);
    await tx
      .update(files)
      .set({ sizeBytes: head.size })
      .where(and(eq(files.id, input.fileId), eq(files.tenantId, ctx.tenantId)));
    for (const ref of links) await linkInTx(tx, ctx, input.fileId, ref, actor);
  });
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'files'));
  return { fileId: input.fileId, sizeBytes: head.size, links };
}

export interface LinkInput extends AttachmentObjectRef {
  fileId: string;
  actor?: Actor;
}

/** Idempotent upsert on the (objectType, objectId, fileId) PK. */
export async function linkAttachment(
  ctx: CoreCtx,
  input: LinkInput,
  access: AttachmentAccess,
): Promise<void> {
  requireAccessIdentity(ctx, access);
  await withLockedAttachmentFile(ctx, input.fileId, [input], async (tx, locked) => {
    requireActiveFile(locked);
    await requireReadableAttachmentFile(tx, ctx, access, locked);
    await requireAttachmentObject(tx, ctx, access, input, 'edit');
    await registerAttachmentInTx(tx, ctx, locked, [...locked.refs, input]);
    await linkInTx(
      tx,
      ctx,
      input.fileId,
      input,
      input.actor ?? { id: access.profileId, name: null },
    );
  });
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'files'));
}
export async function unlinkAttachment(
  ctx: CoreCtx,
  input: LinkInput,
  access: AttachmentAccess,
): Promise<void> {
  requireAccessIdentity(ctx, access);
  await withLockedAttachmentFile(ctx, input.fileId, [input], async (tx, locked) => {
    requireActiveFile(locked);
    await requireAttachmentObject(tx, ctx, access, input, 'edit');
    if (
      !locked.refs.some(
        (ref) => ref.objectType === input.objectType && ref.objectId === input.objectId,
      )
    )
      throw new AttachmentError('not_found', 'attachment link not found');
    await registerAttachmentInTx(tx, ctx, locked);
    await tx
      .delete(attachmentLinks)
      .where(
        and(
          eq(attachmentLinks.orgId, ctx.tenantId),
          eq(attachmentLinks.fileId, input.fileId),
          eq(attachmentLinks.objectType, input.objectType),
          eq(attachmentLinks.objectId, input.objectId),
        ),
      );
    await recordAuditInTx(tx, ctx, {
      refType: input.objectType,
      refId: input.objectId,
      op: 'attachment.unlink',
      changes: [{ field: 'fileId', label: 'Attachment', old: input.fileId, new: null }],
      actor: input.actor ?? { id: access.profileId, name: null },
    });
  });
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'files'));
}

export interface AttachmentWithLinks {
  file: typeof files.$inferSelect;
  links: Array<{ objectType: AttachmentObjectType; objectId: string }>;
}

/** Return only links the acting user can actually read; shared files do not
 * expose identities of hidden records in other modules or owner scopes. */
export async function listAttachmentsFor(
  ctx: CoreCtx,
  objectType: AttachmentObjectType,
  objectId: string,
  access: AttachmentAccess,
): Promise<AttachmentWithLinks[]> {
  requireAccessIdentity(ctx, access);
  const ids = await withOrgCore(ctx, async (tx) => {
    await requireAttachmentObject(tx, ctx, access, { objectType, objectId }, 'view');
    return tx
      .select({ fileId: attachmentLinks.fileId })
      .from(attachmentLinks)
      .where(
        and(
          eq(attachmentLinks.orgId, ctx.tenantId),
          eq(attachmentLinks.objectType, objectType),
          eq(attachmentLinks.objectId, objectId),
        ),
      );
  });
  const result: AttachmentWithLinks[] = [];
  for (const id of [...new Set(ids.map((row) => row.fileId))]) {
    try {
      const found = await withLockedAttachmentFile(ctx, id, [], async (tx, locked) => {
        await requireAttachmentObject(tx, ctx, access, { objectType, objectId }, 'view');
        if (!locked.refs.some((ref) => ref.objectType === objectType && ref.objectId === objectId))
          return null;
        await requireReadableAttachmentFile(tx, ctx, access, locked);
        return { file: locked.file, links: await visibleLinksInTx(tx, ctx, access, locked.refs) };
      });
      if (found) result.push(found);
    } catch (e) {
      if (!(e instanceof AttachmentError) || e.code !== 'not_found') throw e;
    }
  }
  return result;
}
export async function listLinksForFile(ctx: CoreCtx, fileId: string, access: AttachmentAccess) {
  return withLockedAttachmentFile(ctx, fileId, [], async (tx, locked) => {
    await requireReadableAttachmentFile(tx, ctx, access, locked);
    return visibleLinksInTx(tx, ctx, access, locked.refs);
  });
}
export async function deleteAttachment(
  ctx: CoreCtx,
  fileId: string,
  access: AttachmentAccess,
  opts: { force?: boolean } = {},
) {
  await deleteManagedAttachment(ctx, fileId, access, opts.force);
  await invalidateTags([
    ...tags.tenantDomain(ctx.tenantId, 'files'),
    ...tags.entity('file', fileId),
  ]);
}
export async function getAttachmentDownloadUrl(
  ctx: CoreCtx,
  fileId: string,
  access: AttachmentAccess,
) {
  const key = await withLockedAttachmentFile(ctx, fileId, [], async (tx, locked) => {
    await requireReadableAttachmentFile(tx, ctx, access, locked);
    return locked.file.b2FileKey;
  });
  return { url: await getStorage().getSignedUrl(key) };
}

export interface SweepAbandonedUploadsOptions {
  /** Only replay already-authorized deleting claims; never claim active orphans. */
  pendingOnly?: boolean;
  /** Age past which an unlinked `files` row is considered abandoned. */
  olderThanHours?: number;
  /** Rows reaped per call — the tick loop drives this to drain the backlog. */
  limit?: number;
}

export interface SweepAbandonedUploadsResult {
  scanned: number;
  deleted: number;
  storageObjectsDeleted: number;
  failed: number;
}

/**
 * Reap `files` rows created by `createUploadIntent` whose `finalizeUpload`
 * never ran (browser closed mid-upload) — unlinked (no `attachment_links`
 * row), older than the cutoff, `category = 'attachment'`. The storage object
 * may or may not have landed; delete it first when present, then the row.
 */
export async function sweepAbandonedUploads(
  ctx: CoreCtx,
  opts: SweepAbandonedUploadsOptions = {},
): Promise<SweepAbandonedUploadsResult> {
  const olderThanHours = opts.olderThanHours ?? 24;
  const limit = opts.limit ?? 200;
  if (
    !Number.isFinite(olderThanHours) ||
    olderThanHours < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    throw new Error('Invalid attachment sweep bounds');
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000);
  const pending = await withOrgCore(ctx, (tx) =>
    tx
      .select({
        id: attachmentFileState.fileId,
        b2FileKey: attachmentFileState.fileKey,
        attemptAt: sql<Date>`coalesce(${attachmentFileState.deleteAttemptedAt},${attachmentFileState.deleteRequestedAt})`,
      })
      .from(attachmentFileState)
      .where(
        and(
          eq(attachmentFileState.orgId, ctx.tenantId),
          eq(attachmentFileState.state, 'deleting'),
          sql`(${attachmentFileState.uploadExpiresAt} IS NULL OR ${attachmentFileState.uploadExpiresAt} <= now())`,
          sql`(${attachmentFileState.deleteReconciledAt} IS NULL OR coalesce(${attachmentFileState.deleteAttemptedAt},${attachmentFileState.deleteReconciledAt}) <= now()-interval '1 hour')`,
        ),
      )
      .orderBy(
        sql`coalesce(${attachmentFileState.deleteAttemptedAt},${attachmentFileState.deleteRequestedAt})`,
        attachmentFileState.fileId,
      )
      .limit(limit),
  );
  const candidates = opts.pendingOnly
    ? []
    : await withOrgCore(ctx, (tx) =>
        tx
          .select({ id: files.id, b2FileKey: files.b2FileKey, attemptAt: files.createdAt })
          .from(files)
          .where(
            and(
              eq(files.tenantId, ctx.tenantId),
              lt(files.createdAt, cutoff),
              // Durable registration includes files adopted from generic categories.
              sql`(${files.category}='attachment' OR ${files.b2FileKey} LIKE ${ctx.tenantId + '/attachments/%'} OR EXISTS (SELECT 1 FROM ${attachmentFileState} WHERE ${attachmentFileState.fileId}=${files.id}))`,
              notExists(
                tx
                  .select({ fileId: attachmentLinks.fileId })
                  .from(attachmentLinks)
                  .where(eq(attachmentLinks.fileId, files.id)),
              ),
              notExists(
                tx
                  .select({ fileId: attachmentFileState.fileId })
                  .from(attachmentFileState)
                  .where(
                    and(
                      eq(attachmentFileState.fileId, files.id),
                      eq(attachmentFileState.state, 'deleting'),
                    ),
                  ),
              ),
            ),
          )
          .orderBy(files.createdAt, files.id)
          .limit(limit),
      );
  let deleted = 0,
    storageObjectsDeleted = 0,
    failed = 0;
  // Merge bounded fresh/claimed candidates by last attempt. A permanently failed
  // object rotates behind untouched work instead of monopolizing every tick.
  const batch = [...pending, ...candidates]
    .sort(
      (a, b) =>
        new Date(a.attemptAt).getTime() - new Date(b.attemptAt).getTime() ||
        a.id.localeCompare(b.id),
    )
    .slice(0, limit);
  for (const row of batch) {
    try {
      if (!pending.some((p) => p.id === row.id)) {
        const claimed = await withLockedAttachmentFile(ctx, row.id, [], async (tx, locked) => {
          if (locked.refs.length || locked.file.createdAt >= cutoff) return false;
          await claimDeletionInTx(tx, ctx, locked, null);
          return true;
        });
        if (!claimed) continue;
      }
      await withOrgCore(ctx, (tx) =>
        tx
          .update(attachmentFileState)
          .set({ deleteAttemptedAt: new Date() })
          .where(
            and(
              eq(attachmentFileState.fileId, row.id),
              eq(attachmentFileState.orgId, ctx.tenantId),
              eq(attachmentFileState.state, 'deleting'),
            ),
          ),
      );
      const head = await getStorage().head(row.b2FileKey);
      const result = await finishAttachmentDeletion(ctx, row.id, row.b2FileKey);
      if (result) {
        if (result.fileDeleted) deleted++;
        if (head) storageObjectsDeleted++;
      }
    } catch (e) {
      if (e instanceof AttachmentError && e.code === 'not_found') continue;
      failed++;
    }
  }
  if (deleted > 0) await invalidateTags(tags.tenantDomain(ctx.tenantId, 'files'));
  return { scanned: batch.length, deleted, storageObjectsDeleted, failed };
}
