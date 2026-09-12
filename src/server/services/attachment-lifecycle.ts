import { and, eq, sql } from 'drizzle-orm';
import { files } from '@minion-stack/db/pg';
import type { CoreCtx } from '$server/auth/core-ctx';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { attachmentLinks, attachmentFileState } from '$server/db/pg-attachments-schema';
import { getStorage } from '$server/storage/blob';
import {
  AttachmentError,
  ATTACHMENT_OBJECT_MODULE,
  canAccessAttachmentObject,
  lockAttachmentObjectsInTx,
  requireAccessIdentity,
  requireAnyAttachmentCapability,
  type AttachmentAccess,
  type AttachmentObjectRef,
} from './attachment-access';

export type AttachmentFile = typeof files.$inferSelect;
export type AttachmentState = typeof attachmentFileState.$inferSelect;
export async function linksInTx(
  tx: CoreTx,
  ctx: Pick<CoreCtx, 'tenantId'>,
  fileId: string,
): Promise<AttachmentObjectRef[]> {
  const refs = await tx
    .select({ objectType: attachmentLinks.objectType, objectId: attachmentLinks.objectId })
    .from(attachmentLinks)
    .where(and(eq(attachmentLinks.orgId, ctx.tenantId), eq(attachmentLinks.fileId, fileId)));
  return refs as AttachmentObjectRef[];
}
const refKey = (refs: readonly AttachmentObjectRef[]) =>
  refs
    .map((r) => `${r.objectType}:${r.objectId}`)
    .sort()
    .join('|');
class ChangedLinks extends Error {}
export interface LockedAttachmentFile {
  file: AttachmentFile;
  refs: AttachmentObjectRef[];
  state?: AttachmentState;
}
/** One order for all writers/readers: object rows, file rows, state/links.
 * Snapshot changes while acquiring the file lock restart the entire transaction.
 * Storage calls are deliberately outside this callback. */
export async function withLockedAttachmentFile<T>(
  ctx: CoreCtx,
  fileId: string,
  extra: readonly AttachmentObjectRef[],
  fn: (tx: CoreTx, locked: LockedAttachmentFile) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withOrgCore(ctx, async (tx) => {
        const before = await linksInTx(tx, ctx, fileId);
        await lockAttachmentObjectsInTx(tx, ctx, [...before, ...extra]);
        const [file] = await tx
          .select()
          .from(files)
          .where(and(eq(files.id, fileId), eq(files.tenantId, ctx.tenantId)))
          .for('update');
        if (!file) throw new AttachmentError('not_found', 'file not found');
        const refs = await linksInTx(tx, ctx, fileId);
        if (refKey(before) !== refKey(refs)) throw new ChangedLinks();
        const [state] = await tx
          .select()
          .from(attachmentFileState)
          .where(
            and(
              eq(attachmentFileState.fileId, fileId),
              eq(attachmentFileState.orgId, ctx.tenantId),
            ),
          );
        if (state && state.fileKey !== file.b2FileKey)
          throw new AttachmentError('not_found', 'file identity mismatch');
        return fn(tx, { file, refs, state });
      });
    } catch (error) {
      if (!(error instanceof ChangedLinks)) throw error;
    }
  }
  throw new AttachmentError('busy', 'attachment links changed; retry the request');
}
export function isManagedAttachment({ file, refs, state }: LockedAttachmentFile) {
  return (
    !!state ||
    refs.length > 0 ||
    file.category === 'attachment' ||
    file.b2FileKey.startsWith(`${file.tenantId}/attachments/`)
  );
}
export function requireActiveFile(locked: LockedAttachmentFile) {
  if (locked.state?.state === 'deleting') throw new AttachmentError('not_found', 'file not found');
}
export async function registerAttachmentInTx(
  tx: CoreTx,
  ctx: CoreCtx,
  locked: LockedAttachmentFile,
  refs: readonly AttachmentObjectRef[] = locked.refs,
) {
  requireActiveFile(locked);
  const accessModules = refs.length
    ? [...new Set(refs.map((ref) => ATTACHMENT_OBJECT_MODULE[ref.objectType]))]
    : (locked.state?.accessModules ?? []);
  await tx
    .insert(attachmentFileState)
    .values({
      fileId: locked.file.id,
      orgId: ctx.tenantId,
      fileKey: locked.file.b2FileKey,
      accessModules,
      uploadExpiresAt:
        locked.state?.uploadExpiresAt ??
        (isManagedAttachment(locked) ? new Date(Date.now() + 900_000) : null),
    })
    .onConflictDoUpdate({
      target: attachmentFileState.fileId,
      set: {
        accessModules: sql`ARRAY(SELECT DISTINCT unnest(${attachmentFileState.accessModules} || EXCLUDED.access_modules))`,
      },
    });
}
export async function canReadAttachmentFile(
  tx: CoreTx,
  ctx: CoreCtx,
  access: AttachmentAccess,
  locked: LockedAttachmentFile,
) {
  requireAccessIdentity(ctx, access);
  if (locked.state?.state === 'deleting') return false;
  if (!locked.refs.length) {
    if (!locked.state && isManagedAttachment(locked)) return false;
    const modules = locked.state?.accessModules;
    const allowed = modules
      ? modules.some((module) => {
          const cap = access.modules[module as keyof AttachmentAccess['modules']];
          return cap?.view && cap.edit;
        })
      : Object.values(access.modules).some((cap) => cap.view && cap.edit);
    return locked.file.uploadedBy === access.profileId && allowed;
  }
  for (const ref of locked.refs)
    if (await canAccessAttachmentObject(tx, ctx, access, ref, 'view')) return true;
  return false;
}
export async function requireReadableAttachmentFile(
  tx: CoreTx,
  ctx: CoreCtx,
  access: AttachmentAccess,
  locked: LockedAttachmentFile,
) {
  if (!(await canReadAttachmentFile(tx, ctx, access, locked)))
    throw new AttachmentError('not_found', 'file not found');
}
export async function visibleLinksInTx(
  tx: CoreTx,
  ctx: CoreCtx,
  access: AttachmentAccess,
  refs: AttachmentObjectRef[],
) {
  const result: AttachmentObjectRef[] = [];
  for (const ref of refs)
    if (await canAccessAttachmentObject(tx, ctx, access, ref, 'view')) result.push(ref);
  return result;
}
/** Caller holds the record row before invoking this. Retain durable file
 * registrations after the last unlink; a future sweeper may claim them. */
export async function detachObjectAttachmentsInTx(
  tx: CoreTx,
  ctx: Pick<CoreCtx, 'tenantId'>,
  ref: AttachmentObjectRef,
): Promise<void> {
  const refs = await tx
    .select({ fileId: attachmentLinks.fileId })
    .from(attachmentLinks)
    .where(
      and(
        eq(attachmentLinks.orgId, ctx.tenantId),
        eq(attachmentLinks.objectType, ref.objectType),
        eq(attachmentLinks.objectId, ref.objectId),
      ),
    );
  for (const id of [...new Set(refs.map((r) => r.fileId))].sort()) {
    const [file] = await tx
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.tenantId, ctx.tenantId)))
      .for('update');
    if (file) {
      const fileRefs = await linksInTx(tx, { tenantId: ctx.tenantId }, id);
      const accessModules = [
        ...new Set(fileRefs.map((ref) => ATTACHMENT_OBJECT_MODULE[ref.objectType])),
      ];
      await tx
        .insert(attachmentFileState)
        .values({
          fileId: id,
          orgId: ctx.tenantId,
          fileKey: file.b2FileKey,
          accessModules,
          uploadExpiresAt:
            file.category === 'attachment' ||
            file.b2FileKey.startsWith(`${ctx.tenantId}/attachments/`)
              ? new Date(Date.now() + 900_000)
              : null,
        })
        .onConflictDoUpdate({
          target: attachmentFileState.fileId,
          set: {
            accessModules: sql`ARRAY(SELECT DISTINCT unnest(${attachmentFileState.accessModules} || EXCLUDED.access_modules))`,
          },
        });
    }
  }
  await tx
    .delete(attachmentLinks)
    .where(
      and(
        eq(attachmentLinks.orgId, ctx.tenantId),
        eq(attachmentLinks.objectType, ref.objectType),
        eq(attachmentLinks.objectId, ref.objectId),
      ),
    );
}
export async function claimDeletionInTx(
  tx: CoreTx,
  ctx: CoreCtx,
  locked: LockedAttachmentFile,
  requestedBy: string | null,
) {
  if (locked.state?.state === 'deleting') return;
  await registerAttachmentInTx(tx, ctx, locked);
  await tx
    .update(attachmentFileState)
    .set({ state: 'deleting', deleteRequestedAt: new Date(), deleteRequestedBy: requestedBy })
    .where(
      and(
        eq(attachmentFileState.fileId, locked.file.id),
        eq(attachmentFileState.orgId, ctx.tenantId),
      ),
    );
  await tx
    .delete(attachmentLinks)
    .where(
      and(eq(attachmentLinks.orgId, ctx.tenantId), eq(attachmentLinks.fileId, locked.file.id)),
    );
}
/** S3 DeleteObject is idempotent for the immutable key. Failed/interrupted
 * claims remain deleting and are revisited by each bounded sweep, without an
 * expiry that could resurrect the object or strand a permanently leased claim. */
export async function finishAttachmentDeletion(ctx: CoreCtx, fileId: string, key: string) {
  const [claim] = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(attachmentFileState)
      .where(
        and(
          eq(attachmentFileState.fileId, fileId),
          eq(attachmentFileState.orgId, ctx.tenantId),
          eq(attachmentFileState.state, 'deleting'),
        ),
      ),
  );
  if (
    !claim ||
    claim.fileKey !== key ||
    (claim.uploadExpiresAt && claim.uploadExpiresAt.getTime() > Date.now())
  )
    return false;
  await getStorage().delete(key);
  const fileDeleted = await withOrgCore(ctx, async (tx) => {
    const [file] = await tx
      .select({ id: files.id, key: files.b2FileKey })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.tenantId, ctx.tenantId)))
      .for('update');
    const [current] = await tx
      .select()
      .from(attachmentFileState)
      .where(
        and(eq(attachmentFileState.fileId, fileId), eq(attachmentFileState.orgId, ctx.tenantId)),
      );
    if (!current) return false;
    if (current.state !== 'deleting' || current.fileKey !== key || (file && file.key !== key))
      throw new AttachmentError('not_found', 'file identity mismatch');
    await tx.delete(files).where(and(eq(files.id, fileId), eq(files.tenantId, ctx.tenantId)));
    if (current.uploadExpiresAt) {
      // TODO(handoff): Retain tombstones until provider write-quiescence and a
      // retention policy are qualified; an already-started PUT may finish after
      // URL expiry. Reconcile late writes hourly without restoring file access.
      // proposals/2026-09-12-360-continuation-review-followups.md (R2/R4 closure).
      await tx
        .update(attachmentFileState)
        .set({ deleteReconciledAt: new Date(), deleteAttemptedAt: new Date() })
        .where(
          and(eq(attachmentFileState.fileId, fileId), eq(attachmentFileState.orgId, ctx.tenantId)),
        );
    } else {
      await tx
        .delete(attachmentFileState)
        .where(
          and(eq(attachmentFileState.fileId, fileId), eq(attachmentFileState.orgId, ctx.tenantId)),
        );
    }
    return !!file;
  });
  return { fileDeleted };
}
export async function deleteManagedAttachment(
  ctx: CoreCtx,
  fileId: string,
  access: AttachmentAccess,
  force = false,
) {
  requireAccessIdentity(ctx, access);
  requireAnyAttachmentCapability(access, 'edit');
  const key = await withLockedAttachmentFile(ctx, fileId, [], async (tx, locked) => {
    if (locked.state?.state === 'deleting') {
      if (locked.state.deleteRequestedBy !== access.profileId)
        throw new AttachmentError('not_found', 'file not found');
      return locked.state.fileKey;
    }
    await requireReadableAttachmentFile(tx, ctx, access, locked);
    if (locked.refs.length && !force)
      throw new AttachmentError('still_linked', 'attachment still linked to one or more objects');
    for (const ref of locked.refs)
      if (!(await canAccessAttachmentObject(tx, ctx, access, ref, 'edit')))
        throw new AttachmentError('not_found', 'record not found');
    await claimDeletionInTx(tx, ctx, locked, access.profileId);
    return locked.file.b2FileKey;
  });
  await finishAttachmentDeletion(ctx, fileId, key);
}
