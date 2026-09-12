import { and, eq, inArray } from 'drizzle-orm';
import { files } from '@minion-stack/db/pg';
import { invalidateTags, tags } from '@minion-stack/cache';
import { newId } from '$server/db/utils';
import { withOrgCore, type CoreTx } from '$server/db/with-org-core';
import { getStorage } from '$server/storage/blob';
import { recordAuditInTx } from './activity.service';
import { getFileUrl, ATTACHMENT_LIMITS, validateAttachment, assertOrgQuota } from './file.service';
import { attachmentLinks, type AttachmentObjectType } from '$server/db/pg-attachments-schema';
import type { CoreCtx } from '$server/auth/core-ctx';
import type { Module } from './rbac.service';

/** Which module's `edit` capability gates linking/unlinking a document to an
 *  object of this type — attachments have no module of their own. */
export const ATTACHMENT_OBJECT_MODULE: Record<AttachmentObjectType, Module> = {
  crm_contact: 'crm',
  booking: 'scheduling',
  event_type: 'scheduling',
  product: 'pos',
  stk_item: 'stock',
  stk_entry: 'stock',
  fin_invoice: 'finance',
  pos_ticket: 'pos',
};

/**
 * Attachments — the polymorphic "document ↔ object" primitive (spec
 * 2026-09-12-erp-core-modules-attachments-spec §D). A document is a `files`
 * row; `attachment_links` is the join table so one file can attach to a CRM
 * contact, a booking and an invoice at once. `object_id` is never verified
 * against its own table — the link is deliberately no-FK/polymorphic across
 * modules, same posture as `tag_links`.
 */
export type AttachmentErrorCode =
  | 'not_found'
  | 'upload_missing'
  | 'too_large'
  | 'mime_not_allowed'
  | 'quota_exceeded'
  | 'still_linked';

export class AttachmentError extends Error {
  constructor(
    public code: AttachmentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AttachmentError';
  }
}

/** Validated at the API boundary (each route's zod schema); the service
 *  trusts its caller, same posture as tag-links.service's `TagEntityKind`. */
export interface AttachmentObjectRef {
  objectType: AttachmentObjectType;
  objectId: string;
}

export interface Actor {
  id: string | null;
  name: string | null;
}

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
}

export interface UploadIntent {
  fileId: string;
  key: string;
  uploadUrl: string;
  maxBytes: number;
}

/** Validate + reserve a `files` row, then hand back a presigned PUT url. The
 *  object may never actually land (abandoned upload) — `finalizeUpload`
 *  cleans up the row when the storage HEAD comes back empty.
 *  TODO(handoff): no sweeper for `files` rows whose finalize never runs
 *  (browser closed mid-upload); needs a cron to reap stale unlinked rows. */
export async function createUploadIntent(
  ctx: CoreCtx,
  input: CreateUploadIntentInput,
): Promise<UploadIntent> {
  const validation = validateAttachment(input);
  if (!validation.ok) throw new AttachmentError(validation.code, validation.message);
  const quota = await assertOrgQuota(ctx, input.sizeBytes);
  if (!quota.ok) throw new AttachmentError(quota.code, quota.message);

  const id = newId();
  const category = input.category ?? 'attachment';
  const key = `${ctx.tenantId}/attachments/${id}/${input.fileName}`;

  await withOrgCore(ctx, (tx) =>
    tx.insert(files).values({
      id,
      tenantId: ctx.tenantId,
      uploadedBy: input.uploadedBy ?? null,
      b2FileKey: key,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      category,
    }),
  );

  const uploadUrl = await getStorage().presignPut(key, input.contentType, 900, {
    contentLength: input.sizeBytes,
  });

  return { fileId: id, key, uploadUrl, maxBytes: ATTACHMENT_LIMITS.maxFileBytes };
}

export interface FinalizeUploadInput {
  fileId: string;
  links?: AttachmentObjectRef[];
  actor?: Actor;
}

/** Confirm the presigned PUT landed, correct `size_bytes` to the real object
 *  size, and create any requested links — all in one transaction. */
export async function finalizeUpload(ctx: CoreCtx, input: FinalizeUploadInput) {
  const actor: Actor = input.actor ?? { id: null, name: null };
  const links = input.links ?? [];

  const fileRows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(files)
      .where(and(eq(files.id, input.fileId), eq(files.tenantId, ctx.tenantId))),
  );
  const file = fileRows[0];
  if (!file) throw new AttachmentError('not_found', 'file not found');

  const head = await getStorage().head(file.b2FileKey);
  if (!head) {
    await withOrgCore(ctx, (tx) => tx.delete(files).where(eq(files.id, input.fileId)));
    throw new AttachmentError('upload_missing', 'uploaded object not found in storage');
  }
  if (head.size > ATTACHMENT_LIMITS.maxFileBytes) {
    await getStorage().delete(file.b2FileKey);
    await withOrgCore(ctx, (tx) => tx.delete(files).where(eq(files.id, input.fileId)));
    throw new AttachmentError(
      'too_large',
      `uploaded object exceeds ${ATTACHMENT_LIMITS.maxFileBytes} bytes`,
    );
  }

  await withOrgCore(ctx, async (tx) => {
    await tx.update(files).set({ sizeBytes: head.size }).where(eq(files.id, input.fileId));
    for (const ref of links) {
      await linkInTx(tx, ctx, input.fileId, ref, actor);
    }
  });
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'files'));

  return { fileId: input.fileId, sizeBytes: head.size, links };
}

export interface LinkInput extends AttachmentObjectRef {
  fileId: string;
  actor?: Actor;
}

/** Idempotent upsert on the (objectType, objectId, fileId) PK. */
export async function linkAttachment(ctx: CoreCtx, input: LinkInput): Promise<void> {
  const actor = input.actor ?? { id: null, name: null };
  await withOrgCore(ctx, (tx) =>
    linkInTx(
      tx,
      ctx,
      input.fileId,
      { objectType: input.objectType, objectId: input.objectId },
      actor,
    ),
  );
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'files'));
}

export async function unlinkAttachment(ctx: CoreCtx, input: LinkInput): Promise<void> {
  const actor = input.actor ?? { id: null, name: null };
  await withOrgCore(ctx, async (tx) => {
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
      actor,
    });
  });
  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'files'));
}

export interface AttachmentWithLinks {
  file: typeof files.$inferSelect;
  links: Array<{ objectType: AttachmentObjectType; objectId: string }>;
}

/** Files linked to (objectType, objectId), each with its FULL link set (so
 *  the UI can show "also linked to invoice X"). */
export async function listAttachmentsFor(
  ctx: CoreCtx,
  objectType: AttachmentObjectType,
  objectId: string,
): Promise<AttachmentWithLinks[]> {
  return withOrgCore(ctx, async (tx) => {
    const own = await tx
      .select({ fileId: attachmentLinks.fileId })
      .from(attachmentLinks)
      .where(
        and(
          eq(attachmentLinks.orgId, ctx.tenantId),
          eq(attachmentLinks.objectType, objectType),
          eq(attachmentLinks.objectId, objectId),
        ),
      );
    const fileIds = [...new Set(own.map((r) => r.fileId))];
    if (!fileIds.length) return [];

    const [fileRows, linkRows] = await Promise.all([
      tx
        .select()
        .from(files)
        .where(and(eq(files.tenantId, ctx.tenantId), inArray(files.id, fileIds))),
      tx
        .select({
          fileId: attachmentLinks.fileId,
          objectType: attachmentLinks.objectType,
          objectId: attachmentLinks.objectId,
        })
        .from(attachmentLinks)
        .where(
          and(eq(attachmentLinks.orgId, ctx.tenantId), inArray(attachmentLinks.fileId, fileIds)),
        ),
    ]);

    const linksByFile = new Map<string, AttachmentWithLinks['links']>();
    for (const l of linkRows) {
      const list = linksByFile.get(l.fileId) ?? [];
      list.push({ objectType: l.objectType as AttachmentObjectType, objectId: l.objectId });
      linksByFile.set(l.fileId, list);
    }
    return fileRows.map((file) => ({ file, links: linksByFile.get(file.id) ?? [] }));
  });
}

export async function listLinksForFile(
  ctx: CoreCtx,
  fileId: string,
): Promise<Array<{ objectType: AttachmentObjectType; objectId: string }>> {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select({ objectType: attachmentLinks.objectType, objectId: attachmentLinks.objectId })
      .from(attachmentLinks)
      .where(and(eq(attachmentLinks.orgId, ctx.tenantId), eq(attachmentLinks.fileId, fileId))),
  );
  return rows.map((r) => ({
    objectType: r.objectType as AttachmentObjectType,
    objectId: r.objectId,
  }));
}

/** Deletes the file + storage object. Refuses (409-style `still_linked`)
 *  while any link remains, unless `force`. */
export async function deleteAttachment(
  ctx: CoreCtx,
  fileId: string,
  opts: { force?: boolean } = {},
): Promise<void> {
  await withOrgCore(ctx, async (tx) => {
    const linkRows = await tx
      .select({ fileId: attachmentLinks.fileId })
      .from(attachmentLinks)
      .where(and(eq(attachmentLinks.orgId, ctx.tenantId), eq(attachmentLinks.fileId, fileId)))
      .limit(1);
    if (linkRows.length && !opts.force) {
      throw new AttachmentError('still_linked', 'attachment still linked to one or more objects');
    }

    const rows = await tx
      .select({ b2FileKey: files.b2FileKey })
      .from(files)
      .where(and(eq(files.id, fileId), eq(files.tenantId, ctx.tenantId)));
    const found = rows[0];
    if (!found) throw new AttachmentError('not_found', 'file not found');

    await tx
      .delete(attachmentLinks)
      .where(and(eq(attachmentLinks.orgId, ctx.tenantId), eq(attachmentLinks.fileId, fileId)));
    await getStorage().delete(found.b2FileKey);
    await tx.delete(files).where(eq(files.id, fileId));
  });
  await invalidateTags([
    ...tags.tenantDomain(ctx.tenantId, 'files'),
    ...tags.entity('file', fileId),
  ]);
}

/** Presigned download URL for one attachment (404-style `not_found` when missing). */
export async function getAttachmentDownloadUrl(ctx: CoreCtx, fileId: string) {
  const file = await getFileUrl(ctx, fileId);
  if (!file) throw new AttachmentError('not_found', 'file not found');
  return { url: file.url };
}
