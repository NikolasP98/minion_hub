import { eq, and, desc } from 'drizzle-orm';
import { files } from '$server/db/schema';
import { newId, nowMs } from '$server/db/utils';
import { uploadToB2, getSignedDownloadUrl, deleteFromB2 } from '$server/storage/b2';
import type { TenantContext } from './base';

export interface FileUploadInput {
  fileName: string;
  contentType: string;
  data: Buffer | Uint8Array;
  category?: string;
  uploadedBy?: string;
}

export async function uploadFile(ctx: TenantContext, input: FileUploadInput) {
  const id = newId();
  const category = input.category ?? 'general';
  const b2FileKey = `${ctx.tenantId}/${category}/${id}/${input.fileName}`;

  await uploadToB2(b2FileKey, input.data, input.contentType);

  await ctx.db.insert(files).values({
    id,
    tenantId: ctx.tenantId,
    uploadedBy: input.uploadedBy ?? null,
    b2FileKey,
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.data.byteLength,
    category,
    createdAt: nowMs(),
  });

  return id;
}

export async function getFileUrl(ctx: TenantContext, id: string) {
  const rows = await ctx.db
    .select()
    .from(files)
    .where(and(eq(files.id, id), eq(files.tenantId, ctx.tenantId)));

  const file = rows[0];
  if (!file) return null;

  const url = await getSignedDownloadUrl(file.b2FileKey);
  return { ...file, url };
}

export async function deleteFile(ctx: TenantContext, id: string) {
  const rows = await ctx.db
    .select({ b2FileKey: files.b2FileKey })
    .from(files)
    .where(and(eq(files.id, id), eq(files.tenantId, ctx.tenantId)));

  const file = rows[0];
  if (!file) return;

  await deleteFromB2(file.b2FileKey);
  await ctx.db.delete(files).where(eq(files.id, id));
}

export async function listFiles(ctx: TenantContext, category?: string) {
  let query = ctx.db
    .select()
    .from(files)
    .where(eq(files.tenantId, ctx.tenantId))
    .orderBy(desc(files.createdAt))
    .$dynamic();

  if (category) {
    query = query.where(and(eq(files.tenantId, ctx.tenantId), eq(files.category, category)));
  }

  return query.limit(200);
}
