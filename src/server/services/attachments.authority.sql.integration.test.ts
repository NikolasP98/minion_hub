import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest';
import { sql } from 'drizzle-orm';
const boundary = vi.hoisted(() => ({
  storage: {
    put: vi.fn(async () => {}),
    presignPut: vi.fn(async () => 'https://fixture.invalid/put'),
    head: vi.fn(async () => ({ size: 42, contentType: 'application/pdf' })),
    delete: vi.fn(async () => {}),
    getSignedUrl: vi.fn(async () => 'https://fixture.invalid/read'),
  },
  ctx: null as unknown,
  caps: null as unknown,
}));
vi.mock('$server/storage/blob', () => ({ getStorage: () => boundary.storage }));
vi.mock('$env/dynamic/private', () => ({ env: { CRON_SECRET: 'disposable-attachment-tick' } }));
vi.mock('$server/db/pg-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$server/db/pg-client')>()),
  getCoreDb: () => (boundary.ctx as import('$server/auth/core-ctx').CoreCtx).db,
}));
vi.mock('$server/auth/core-ctx', () => ({ getCoreCtx: async () => boundary.ctx }));
vi.mock('$server/services/rbac.service', () => ({
  hasOrgCapability: async (_locals: unknown, module: string, action: string) =>
    (boundary.caps as Record<string, Record<string, unknown>>)[module]?.[action] === true,
  ownerFilter: async (_locals: unknown, module: string) =>
    (boundary.caps as Record<string, { ownerId?: string }>)[module]?.ownerId,
}));
import { withOrgCore } from '$server/db/with-org-core';
import {
  getAttachmentDownloadUrl,
  listAttachmentsFor,
  linkAttachment,
  unlinkAttachment,
  deleteAttachment,
  createUploadIntent,
  finalizeUpload,
} from './attachments.service';
import { getAuthorizedFileUrl, listAuthorizedFiles, deleteAuthorizedFile } from './file.service';
import { GET as genericGet, DELETE as genericDelete } from '../../routes/api/files/[id]/+server';
import { GET as deletionTick } from '../../routes/api/attachments/sweep/tick/+server';
import { GET as rawGet } from '../../routes/api/files/[id]/raw/+server';
import { GET as listGet, POST as proxyPost } from '../../routes/api/files/+server';
import { GET as attachmentGet } from '../../routes/api/attachments/[fileId]/+server';
import { POST as linkPost } from '../../routes/api/attachments/[fileId]/links/+server';
import { POST as finalizePost } from '../../routes/api/attachments/finalize/+server';
import {
  openAttachmentFixture,
  access,
  ORG,
  OTHER_ORG,
  USER,
  OTHER_USER,
  CONTACT,
  BOOKING,
  INVOICE,
} from '$server/test-utils/attachment-postgres-fixture';
let f: Awaited<ReturnType<typeof openAttachmentFixture>>;
beforeAll(async () => {
  f = await openAttachmentFixture();
  console.info('attachment authority native receipt', f.receipt);
});
afterAll(async () => {
  await f?.close();
});
beforeEach(async () => {
  await f.reset();
  vi.clearAllMocks();
  boundary.ctx = f.ctx;
  boundary.caps = access().modules;
});
const ref = { objectType: 'crm_contact' as const, objectId: CONTACT };
const booking = { objectType: 'booking' as const, objectId: BOOKING };
const invoice = { objectType: 'fin_invoice' as const, objectId: INVOICE };
function event(id = 'file-a', body?: unknown) {
  return {
    locals: { user: { supabaseId: USER }, tenantCtx: { tenantId: ORG } },
    params: { id, fileId: id },
    url: new URL('http://fixture.invalid/api/files'),
    request: new Request('http://fixture.invalid/api/files', {
      method: body ? 'POST' : 'GET',
      ...(body
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    }),
  } as never;
}
async function seededLinked() {
  await f.seedFile();
  await linkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
  vi.clearAllMocks();
}
describe('native attachment authority', () => {
  it('RLS filters files and rejects a foreign lifecycle insert even without caller tenant predicates', async () => {
    await f.seedFile();
    await f.seedFile('other', { tenantId: OTHER_ORG });
    const rows = await withOrgCore(f.ctx, (tx) => tx.execute(sql`select id from files`));
    expect(rows.map((r) => r.id)).toEqual(['file-a']);
    await expect(
      withOrgCore(f.ctx, (tx) =>
        tx.execute(
          sql`insert into attachment_file_state(file_id,org_id,file_key) values ('bad',${OTHER_ORG},'other')`,
        ),
      ),
    ).rejects.toThrow();
  });
  it('new lifecycle table denies provider browser roles even under permissive table defaults', async () => {
    const grants =
      await f.owner`SELECT has_table_privilege('anon',${f.schema + '.attachment_file_state'},'SELECT') AS anon_read,
      has_table_privilege('authenticated',${f.schema + '.attachment_file_state'},'SELECT') AS auth_read,
      has_table_privilege('anon',${f.schema + '.attachment_file_state'},'INSERT') AS anon_write,
      has_table_privilege('authenticated',${f.schema + '.attachment_file_state'},'UPDATE') AS auth_write`;
    expect(grants).toEqual([
      { anon_read: false, auth_read: false, anon_write: false, auth_write: false },
    ]);
    const policies =
      await f.owner`SELECT roles FROM pg_policies WHERE schemaname=${f.schema} AND tablename='attachment_file_state'`;
    expect(policies).toEqual([{ roles: ['app_ledger'] }]);
  });
  it('cannot read or claim a file in another tenant', async () => {
    await f.seedFile('other', { tenantId: OTHER_ORG });
    await expect(getAttachmentDownloadUrl(f.ctx, 'other', access())).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      linkAttachment(f.ctx, { fileId: 'other', ...ref }, access()),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(boundary.storage.getSignedUrl).not.toHaveBeenCalled();
  });
  it('validates existence and tenant identity of every supported target type', async () => {
    await f.seedFile();
    for (const objectType of [
      'crm_contact',
      'booking',
      'event_type',
      'product',
      'stk_item',
      'stk_entry',
      'fin_invoice',
      'pos_ticket',
    ] as const) {
      await expect(
        linkAttachment(f.ctx, { fileId: 'file-a', objectType, objectId: OTHER_ORG }, access()),
      ).rejects.toMatchObject({ code: 'not_found' });
    }
    expect(await f.owner`select * from attachment_links`).toHaveLength(0);
    expect(await f.owner`select * from doc_audit_log`).toHaveLength(0);
  });
  it('owner-scoped CRM access rejects non-owned and soft-deleted records', async () => {
    await seededLinked();
    const restricted = access({ crm: { view: true, edit: true, ownerId: OTHER_USER } });
    await expect(
      listAttachmentsFor(f.ctx, 'crm_contact', CONTACT, restricted),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(getAttachmentDownloadUrl(f.ctx, 'file-a', restricted)).rejects.toMatchObject({
      code: 'not_found',
    });
    await f.owner`update crm_contacts set deleted_at=now() where id=${CONTACT}`;
    await expect(
      getAttachmentDownloadUrl(f.ctx, 'file-a', access({ crm: { view: false, edit: false } })),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(boundary.storage.getSignedUrl).not.toHaveBeenCalled();
  });
  it('a visible link allows the file but never exposes hidden cross-links', async () => {
    await seededLinked();
    await linkAttachment(f.ctx, { fileId: 'file-a', ...invoice }, access());
    const reader = access({ finance: { view: false, edit: false } });
    const rows = await listAttachmentsFor(f.ctx, 'crm_contact', CONTACT, reader);
    expect(rows[0].links).toEqual([ref]);
    await expect(getAttachmentDownloadUrl(f.ctx, 'file-a', reader)).resolves.toMatchObject({
      url: 'https://fixture.invalid/read',
    });
    await expect(deleteAttachment(f.ctx, 'file-a', reader, { force: true })).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      unlinkAttachment(f.ctx, { fileId: 'file-a', ...invoice }, reader),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(boundary.storage.delete).not.toHaveBeenCalled();
    expect(await f.owner`select * from attachment_links`).toHaveLength(2);
  });
  it('uploader identity does not bypass linked-record module revocation', async () => {
    await seededLinked();
    const revoked = access({ crm: { view: false, edit: false } });
    await expect(getAttachmentDownloadUrl(f.ctx, 'file-a', revoked)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      linkAttachment(f.ctx, { fileId: 'file-a', ...booking }, revoked),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(boundary.storage.getSignedUrl).not.toHaveBeenCalled();
  });
  it('unlinked upload requires uploader identity and a current module edit capability', async () => {
    await f.seedFile();
    await expect(getAttachmentDownloadUrl(f.ctx, 'file-a', access())).resolves.toBeDefined();
    await expect(
      getAttachmentDownloadUrl(
        { ...f.ctx, profileId: OTHER_USER },
        'file-a',
        access({}, OTHER_USER),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    const readonly = access();
    for (const cap of Object.values(readonly.modules)) cap.edit = false;
    await expect(getAttachmentDownloadUrl(f.ctx, 'file-a', readonly)).rejects.toMatchObject({
      code: 'not_found',
    });
  });
  it('last unlink and typed intent retain module provenance against unrelated-module bypass', async () => {
    await seededLinked();
    await unlinkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    const revoked = access({ crm: { view: false, edit: false } });
    await expect(getAuthorizedFileUrl(f.ctx, 'file-a', revoked)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      finalizeUpload(f.ctx, { fileId: 'file-a', links: [booking] }, revoked),
    ).rejects.toMatchObject({ code: 'not_found' });
    const upload = await createUploadIntent(
      f.ctx,
      { fileName: 'typed.pdf', contentType: 'application/pdf', sizeBytes: 42, links: [ref] },
      access(),
    );
    await expect(getAttachmentDownloadUrl(f.ctx, upload.fileId, revoked)).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      linkAttachment(f.ctx, { fileId: upload.fileId, ...booking }, revoked),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(boundary.storage.getSignedUrl).not.toHaveBeenCalled();
    expect(boundary.storage.head).not.toHaveBeenCalled();
  });
  it('unknown managed orphan is denied before and after migration classification, while own generic adoption remains possible', async () => {
    await f.seedFile('legacy', { registered: false });
    await expect(getAuthorizedFileUrl(f.ctx, 'legacy', access())).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(
      linkAttachment(f.ctx, { fileId: 'legacy', ...ref }, access()),
    ).rejects.toMatchObject({ code: 'not_found' });
    await f.owner`INSERT INTO attachment_file_state(file_id,org_id,file_key) SELECT id,tenant_id::text,b2_file_key FROM files WHERE id='legacy'`;
    await expect(getAuthorizedFileUrl(f.ctx, 'legacy', access())).rejects.toMatchObject({
      code: 'not_found',
    });
    await f.seedFile('generic', { category: 'general', key: `${ORG}/general/generic/data` });
    await expect(
      linkAttachment(f.ctx, { fileId: 'generic', ...ref }, access()),
    ).resolves.toBeUndefined();
    expect(boundary.storage.getSignedUrl).not.toHaveBeenCalled();
  });
  it('actual proxy handler authorizes typed targets before reservation and storage and retains their module', async () => {
    const request = (target: typeof ref) => {
      const form = new FormData();
      form.set('file', new File(['fixture'], 'a.pdf', { type: 'application/pdf' }));
      form.set('category', 'attachment');
      form.set('links', JSON.stringify([target]));
      return {
        locals: { user: { supabaseId: USER }, tenantCtx: { tenantId: ORG } },
        request: new Request('http://fixture.invalid/api/files', { method: 'POST', body: form }),
      } as never;
    };
    expect((await proxyPost(request({ ...ref, objectId: OTHER_ORG }))).status).toBe(404);
    expect(await f.owner`SELECT id FROM files`).toHaveLength(0);
    expect(boundary.storage.put).not.toHaveBeenCalled();
    const response = await proxyPost(request(ref));
    expect(response.status).toBe(200);
    const { id } = await response.json();
    expect(boundary.storage.put).toHaveBeenCalledTimes(1);
    expect(
      await f.owner`SELECT access_modules FROM attachment_file_state WHERE file_id=${id}`,
    ).toEqual([{ access_modules: ['crm'] }]);
    await expect(
      getAttachmentDownloadUrl(f.ctx, id, access({ crm: { view: false, edit: false } })),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('cannot claim another uploader generic file as an attachment or finalize it', async () => {
    await f.seedFile('generic', {
      uploadedBy: OTHER_USER,
      category: 'general',
      key: `${ORG}/general/generic/data`,
    });
    await expect(
      linkAttachment(f.ctx, { fileId: 'generic', ...ref }, access()),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      finalizeUpload(f.ctx, { fileId: 'generic', links: [ref] }, access()),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await f.owner`select * from attachment_file_state`).toHaveLength(0);
    expect(boundary.storage.head).not.toHaveBeenCalled();
  });
  it('typed upload rejects missing targets before reserving or signing; actor/category are server owned', async () => {
    await expect(
      createUploadIntent(
        f.ctx,
        {
          fileName: 'a.pdf',
          contentType: 'application/pdf',
          sizeBytes: 42,
          links: [{ ...ref, objectId: OTHER_ORG }],
        },
        access(),
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await f.owner`select * from files`).toHaveLength(0);
    expect(boundary.storage.presignPut).not.toHaveBeenCalled();
    const upload = await createUploadIntent(
      f.ctx,
      {
        fileName: 'a.pdf',
        contentType: 'application/pdf',
        sizeBytes: 42,
        uploadedBy: OTHER_USER,
        category: 'general',
        links: [ref],
      },
      access(),
    );
    const [row] = await f.owner`select * from files where id=${upload.fileId}`;
    expect(row.uploaded_by).toBe(USER);
    expect(row.category).toBe('attachment');
  });
  it('durable classification survives last unlink and user-controlled category changes', async () => {
    await f.seedFile('file-a', { category: 'general', key: `${ORG}/general/file-a/data` });
    await linkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    await unlinkAttachment(f.ctx, { fileId: 'file-a', ...ref }, access());
    await f.owner`update files set category='avatar' where id='file-a'`;
    const other = { ...f.ctx, profileId: OTHER_USER };
    await expect(
      getAuthorizedFileUrl(other, 'file-a', access({}, OTHER_USER)),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(
      deleteAuthorizedFile(other, 'file-a', access({}, OTHER_USER)),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(await listAuthorizedFiles(other, undefined, access({}, OTHER_USER))).toEqual([]);
    expect(boundary.storage.delete).not.toHaveBeenCalled();
  });
  it('actual attachment, generic detail/raw/delete and finalize/link handlers deny the same hidden record', async () => {
    await seededLinked();
    boundary.caps = access({ crm: { view: true, edit: true, ownerId: OTHER_USER } }).modules;
    for (const handler of [attachmentGet, genericGet, rawGet, genericDelete])
      expect((await handler(event())).status).toBe(404);
    expect((await linkPost(event('file-a', ref))).status).toBe(404);
    expect((await finalizePost(event('file-a', { fileId: 'file-a', links: [ref] }))).status).toBe(
      404,
    );
    const list = await listGet(event());
    expect(await list.json()).toEqual({ files: [] });
    expect(boundary.storage.getSignedUrl).not.toHaveBeenCalled();
    expect(boundary.storage.delete).not.toHaveBeenCalled();
    expect(boundary.storage.head).not.toHaveBeenCalled();
  });
  it('actual claims-only tick resumes authorized deletion and never claims an active old orphan', async () => {
    await f.seedFile('pending');
    await f.seedFile('untouched', { old: true, registered: false });
    boundary.storage.delete.mockRejectedValueOnce(new Error('fixture failed delete'));
    await expect(deleteAttachment(f.ctx, 'pending', access())).rejects.toThrow(
      'fixture failed delete',
    );
    const url = new URL('http://fixture.invalid/api/attachments/sweep/tick?mode=deletion-claims');
    const response = await deletionTick({
      url,
      request: new Request(url, {
        headers: { authorization: 'Bearer disposable-attachment-tick' },
      }),
    } as never);
    expect(await response.json()).toMatchObject({
      ok: true,
      mode: 'deletion-claims',
      scanned: 1,
      deleted: 1,
      error: 0,
    });
    expect(await f.owner`SELECT id FROM files`).toEqual([{ id: 'untouched' }]);
    expect(
      await f.owner`SELECT file_id FROM attachment_file_state WHERE file_id='untouched'`,
    ).toHaveLength(0);
  });
  it('preserves generic-file visibility and avatar caching while attachment raw redirects are not cached', async () => {
    await f.seedFile('avatar', { category: 'avatar', key: `${ORG}/avatar/image` });
    const avatar = await rawGet(event('avatar'));
    expect(avatar.status).toBe(302);
    expect(avatar.headers.get('Cache-Control')).toBe('private, max-age=3600');
    await seededLinked();
    const attachment = await rawGet(event());
    expect(attachment.status).toBe(302);
    expect(attachment.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
