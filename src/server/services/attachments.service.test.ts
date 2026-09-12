import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { CoreTx } from '$server/db/with-org-core';
import type { CoreCtx } from '$server/auth/core-ctx';
import {
  ATTACHMENT_FIXTURE_DDL,
  migrationSource,
  access,
  ORG,
  USER,
  CONTACT,
} from '$server/test-utils/attachment-postgres-fixture';
import {
  createUploadIntent,
  finalizeUpload,
  linkAttachment,
  deleteAttachment,
  listAttachmentsFor,
  sweepAbandonedUploads,
  AttachmentError,
} from './attachments.service';
import { ATTACHMENT_LIMITS } from './file.service';
// Fast embedded service seam tests; these do not qualify production ACL/RLS.
// Native authority/lifecycle suites load the independently reviewed catalog.
vi.mock('$server/db/with-org-core', () => ({
  withOrgCore: (scope: CoreCtx, fn: (tx: CoreTx) => Promise<unknown>) => scope.db.transaction(fn),
}));
vi.mock('$server/services/rbac.service', () => ({
  hasOrgCapability: vi.fn(),
  ownerFilter: vi.fn(),
}));
const store = vi.hoisted(() => ({
  presignPut: vi.fn(async () => 'https://signed-put.invalid/upload'),
  head: vi.fn<() => Promise<{ size: number; contentType: string } | null>>(),
  delete: vi.fn<() => Promise<void>>(),
  getSignedUrl: vi.fn(async () => 'https://signed-get.invalid/download'),
}));
vi.mock('$server/storage/blob', () => ({ getStorage: () => store }));
let client: PGlite;
let ctx: CoreCtx;
beforeEach(async () => {
  vi.clearAllMocks();
  store.head.mockResolvedValue({ size: 42, contentType: 'application/pdf' });
  store.delete.mockResolvedValue();
  client = new PGlite();
  await client.exec(`CREATE ROLE app_ledger;${ATTACHMENT_FIXTURE_DDL}`);
  await client.exec(migrationSource('20260912090100_attachment_links.sql'));
  await client.exec(migrationSource('20260913020000_attachment_file_state.sql'));
  await client.query('INSERT INTO crm_contacts(id,org_id,owner_id) VALUES ($1,$2,$3)', [
    CONTACT,
    ORG,
    USER,
  ]);
  ctx = { db: drizzle(client) as unknown as CoreCtx['db'], tenantId: ORG, profileId: USER };
});
afterEach(async () => {
  await client?.close();
});
async function seed(
  id = 'file-a',
  options: { category?: string; old?: boolean; size?: number; key?: string } = {},
) {
  await client.query(
    "INSERT INTO files VALUES ($1,$2,$3,$4,'file.pdf','application/pdf',$5,$6,$7)",
    [
      id,
      ORG,
      USER,
      options.key ?? `${ORG}/attachments/${id}/file.pdf`,
      options.size ?? 42,
      options.category ?? 'attachment',
      options.old ? new Date(Date.now() - 48 * 3600000) : new Date(),
    ],
  );
  if ((options.category ?? 'attachment') === 'attachment')
    await client.query(
      "INSERT INTO attachment_file_state(file_id,org_id,file_key,access_modules) VALUES ($1,$2,$3,ARRAY['crm','scheduling','pos','stock','finance'])",
      [id, ORG, options.key ?? `${ORG}/attachments/${id}/file.pdf`],
    );
}
const ref = { objectType: 'crm_contact' as const, objectId: CONTACT };
describe('attachment upload validation and reservation', () => {
  it('rejects oversized input before reserving or signing', async () => {
    await expect(
      createUploadIntent(
        ctx,
        { fileName: 'huge.pdf', contentType: 'application/pdf', sizeBytes: 999999999 },
        access(),
      ),
    ).rejects.toBeInstanceOf(AttachmentError);
    expect(store.presignPut).not.toHaveBeenCalled();
  });
  it('rejects disallowed MIME types', async () => {
    await expect(
      createUploadIntent(
        ctx,
        { fileName: 'script.exe', contentType: 'application/x-msdownload', sizeBytes: 100 },
        access(),
      ),
    ).rejects.toMatchObject({ code: 'mime_not_allowed' });
  });
  it('enforces the existing organization quota', async () => {
    await seed('full', { size: ATTACHMENT_LIMITS.orgQuotaBytes });
    await expect(
      createUploadIntent(
        ctx,
        { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100 },
        access(),
      ),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(store.presignPut).not.toHaveBeenCalled();
  });
  it('reserves file and durable identity atomically and signs the actual size limit', async () => {
    const intent = await createUploadIntent(
      ctx,
      { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 100, links: [ref] },
      access(),
    );
    expect(intent.uploadUrl).toBe('https://signed-put.invalid/upload');
    expect(store.presignPut).toHaveBeenCalledWith(
      `${ORG}/attachments/${intent.fileId}/a.pdf`,
      'application/pdf',
      900,
      { contentLength: 100 },
    );
    expect((await client.query('SELECT * FROM attachment_file_state')).rows).toHaveLength(1);
  });
});
describe('finalize and link', () => {
  it('rejects missing files without inspecting storage', async () => {
    await expect(finalizeUpload(ctx, { fileId: 'missing' }, access())).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(store.head).not.toHaveBeenCalled();
  });
  it('claims and removes a missing upload without leaving a file registration', async () => {
    await seed();
    store.head.mockResolvedValue(null);
    await expect(finalizeUpload(ctx, { fileId: 'file-a' }, access())).rejects.toMatchObject({
      code: 'upload_missing',
    });
    expect((await client.query('SELECT * FROM files')).rows).toHaveLength(0);
    expect((await client.query('SELECT * FROM attachment_file_state')).rows).toHaveLength(0);
  });
  it('updates actual object size and creates authorized links', async () => {
    await seed();
    store.head.mockResolvedValue({ size: 4321, contentType: 'application/pdf' });
    expect(await finalizeUpload(ctx, { fileId: 'file-a', links: [ref] }, access())).toMatchObject({
      sizeBytes: 4321,
      links: [ref],
    });
    expect((await client.query('SELECT size_bytes FROM files')).rows).toEqual([
      { size_bytes: 4321 },
    ]);
  });
  it('idempotently links and audits an existing authorized record', async () => {
    await seed();
    await linkAttachment(ctx, { fileId: 'file-a', ...ref }, access());
    await linkAttachment(ctx, { fileId: 'file-a', ...ref }, access());
    expect((await client.query('SELECT * FROM attachment_links')).rows).toHaveLength(1);
    expect((await client.query('SELECT * FROM doc_audit_log')).rows).toHaveLength(2);
  });
  it('returns no attachments for an existing empty record', async () => {
    expect(await listAttachmentsFor(ctx, 'crm_contact', CONTACT, access())).toEqual([]);
  });
  it('returns authorized file metadata and its visible link set', async () => {
    await seed();
    await linkAttachment(ctx, { fileId: 'file-a', ...ref }, access());
    const result = await listAttachmentsFor(ctx, 'crm_contact', CONTACT, access());
    expect(result).toHaveLength(1);
    expect(result[0].links).toEqual([ref]);
  });
});
describe('claimed attachment deletion', () => {
  it('refuses ordinary deletion while linked without touching storage', async () => {
    await seed();
    await linkAttachment(ctx, { fileId: 'file-a', ...ref }, access());
    await expect(deleteAttachment(ctx, 'file-a', access())).rejects.toMatchObject({
      code: 'still_linked',
    });
    expect(store.delete).not.toHaveBeenCalled();
  });
  it('force deletion removes authorized links before the external effect', async () => {
    await seed();
    await linkAttachment(ctx, { fileId: 'file-a', ...ref }, access());
    store.delete.mockImplementationOnce(async () => {
      expect((await client.query('SELECT * FROM attachment_links')).rows).toHaveLength(0);
      expect((await client.query('SELECT state FROM attachment_file_state')).rows).toEqual([
        { state: 'deleting' },
      ]);
    });
    await deleteAttachment(ctx, 'file-a', access(), { force: true });
    expect((await client.query('SELECT * FROM files')).rows).toHaveLength(0);
  });
  it('rejects a missing file', async () => {
    await expect(deleteAttachment(ctx, 'missing', access())).rejects.toMatchObject({
      code: 'not_found',
    });
  });
  it('retains a failed claim and retries that exact immutable key', async () => {
    await seed();
    store.delete.mockRejectedValueOnce(new Error('disposable-store-failure'));
    await expect(deleteAttachment(ctx, 'file-a', access())).rejects.toThrow(
      'disposable-store-failure',
    );
    expect((await client.query('SELECT state FROM attachment_file_state')).rows).toEqual([
      { state: 'deleting' },
    ]);
    await deleteAttachment(ctx, 'file-a', access());
    expect(store.delete).toHaveBeenCalledTimes(2);
  });
});
describe('bounded abandoned upload sweep', () => {
  it('retains linked/recent/unmanaged files and reaps old managed files', async () => {
    await seed('old', { old: true });
    await seed('linked', { old: true });
    await linkAttachment(ctx, { fileId: 'linked', ...ref }, access());
    await seed('recent');
    await seed('avatar', { old: true, category: 'avatar', key: `${ORG}/avatar/avatar/file` });
    expect(await sweepAbandonedUploads(ctx)).toEqual({
      scanned: 1,
      deleted: 1,
      storageObjectsDeleted: 1,
      failed: 0,
    });
    expect(
      (await client.query<{ id: string }>('SELECT id FROM files ORDER BY id')).rows.map(
        (row) => row.id,
      ),
    ).toEqual(['avatar', 'linked', 'recent']);
  });
  it('idempotently deletes a missing storage object and its row', async () => {
    await seed('ghost', { old: true });
    store.head.mockResolvedValue(null);
    expect(await sweepAbandonedUploads(ctx)).toEqual({
      scanned: 1,
      deleted: 1,
      storageObjectsDeleted: 0,
      failed: 0,
    });
    expect(store.delete).toHaveBeenCalledTimes(1);
  });
  it('respects per-tick bounds', async () => {
    for (const id of ['a', 'b', 'c']) await seed(id, { old: true });
    expect((await sweepAbandonedUploads(ctx, { limit: 2 })).deleted).toBe(2);
    expect((await client.query('SELECT * FROM files')).rows).toHaveLength(1);
  });
  it('resumes a failed deletion on the next tick without marking it active', async () => {
    await seed('old', { old: true });
    store.delete.mockRejectedValueOnce(new Error('store unavailable'));
    expect((await sweepAbandonedUploads(ctx)).failed).toBe(1);
    expect((await sweepAbandonedUploads(ctx)).deleted).toBe(1);
  });
});
