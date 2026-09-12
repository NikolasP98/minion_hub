import { eq, and, desc, sql } from 'drizzle-orm';
import { files } from '@minion-stack/db/pg';
import { cached, invalidateTags, keys, tags } from '@minion-stack/cache';
import { newId } from '$server/db/utils';
import { withOrgCore } from '$server/db/with-org-core';
import { getStorage } from '$server/storage/blob';
import { scopeData } from './base';
import type { CoreCtx } from '$server/auth/core-ctx';

// Limits + MIME allowlist + the pure validator live in a client-safe module
// (`$lib/attachments/limits`) so `AttachmentButton`'s pre-check can import the
// same constants without pulling in server-only code. Re-exported here so
// every existing server import site (this file's callers, routes, tests)
// keeps working unchanged.
export {
  ATTACHMENT_LIMITS,
  ATTACHMENT_MIME_ALLOWLIST,
  validateAttachment,
  type AttachmentValidationCode,
  type AttachmentValidationResult,
} from '$lib/attachments/limits';
import { ATTACHMENT_LIMITS, type AttachmentValidationResult } from '$lib/attachments/limits';

/** Org storage quota check — sums `files.size_bytes` for this tenant (no
 *  dedicated quota column; the running total IS the source of truth). */
export async function assertOrgQuota(
  ctx: CoreCtx,
  additionalBytes: number,
): Promise<AttachmentValidationResult> {
  const used = await withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .select({ total: sql<number>`coalesce(sum(${files.sizeBytes}), 0)` })
      .from(files)
      .where(eq(files.tenantId, ctx.tenantId));
    return Number(rows[0]?.total ?? 0);
  });
  if (used + additionalBytes > ATTACHMENT_LIMITS.orgQuotaBytes) {
    return {
      ok: false,
      code: 'quota_exceeded',
      message: `org storage quota exceeded (limit ${ATTACHMENT_LIMITS.orgQuotaBytes} bytes)`,
    };
  }
  return { ok: true };
}

export interface FileUploadInput {
  fileName: string;
  contentType: string;
  data: Buffer | Uint8Array;
  category?: string;
  uploadedBy?: string;
  /** e.g. 'public, max-age=31536000, immutable' for immutable-by-fileId blobs (meta thumbnails). */
  cacheControl?: string;
}

export async function uploadFile(ctx: CoreCtx, input: FileUploadInput) {
  const id = newId();
  const category = input.category ?? 'general';
  const b2FileKey = `${ctx.tenantId}/${category}/${id}/${input.fileName}`;

  await getStorage().put(b2FileKey, input.data, input.contentType, {
    cacheControl: input.cacheControl,
  });

  await withOrgCore(ctx, (tx) =>
    tx.insert(files).values({
      id,
      tenantId: ctx.tenantId,
      uploadedBy: input.uploadedBy ?? null,
      b2FileKey,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.data.byteLength,
      category,
    }),
  );

  await invalidateTags(tags.tenantDomain(ctx.tenantId, 'files'));
  return id;
}

export async function getFileUrl(ctx: CoreCtx, id: string, expiresIn?: number) {
  const rows = await withOrgCore(ctx, (tx) =>
    tx
      .select()
      .from(files)
      .where(and(eq(files.id, id), eq(files.tenantId, ctx.tenantId))),
  );

  const file = rows[0];
  if (!file) return null;

  const url = await getStorage().getSignedUrl(file.b2FileKey, expiresIn);
  return { ...file, url };
}

export async function deleteFile(ctx: CoreCtx, id: string) {
  const file = await withOrgCore(ctx, async (tx) => {
    const rows = await tx
      .select({ b2FileKey: files.b2FileKey })
      .from(files)
      .where(and(eq(files.id, id), eq(files.tenantId, ctx.tenantId)));

    const found = rows[0];
    if (!found) return null;

    await getStorage().delete(found.b2FileKey);
    await tx.delete(files).where(eq(files.id, id));
    return found;
  });
  if (!file) return;

  await invalidateTags([...tags.tenantDomain(ctx.tenantId, 'files'), ...tags.entity('file', id)]);
}

export async function listFiles(ctx: CoreCtx, category?: string) {
  return cached(
    keys.hub('files', { t: ctx.tenantId, d: scopeData({ category }) }),
    {
      ttl: '5m',
      swr: '30s',
      tags: tags.tenantDomain(ctx.tenantId, 'files'),
    },
    async () =>
      withOrgCore(ctx, (tx) => {
        let query = tx
          .select()
          .from(files)
          .where(eq(files.tenantId, ctx.tenantId))
          .orderBy(desc(files.createdAt))
          .$dynamic();

        if (category) {
          query = query.where(and(eq(files.tenantId, ctx.tenantId), eq(files.category, category)));
        }

        return query.limit(200);
      }),
  );
}
