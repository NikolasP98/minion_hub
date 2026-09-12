import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockDb } from '$server/test-utils/mock-db';
import {
  createUploadIntent,
  finalizeUpload,
  linkAttachment,
  deleteAttachment,
  listAttachmentsFor,
  AttachmentError,
} from './attachments.service';

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-file-id-0000000001',
  nowMs: () => 1_700_000_000_000,
}));

const mockPresignPut = vi
  .fn<(k: string, ct: string, expiresIn?: number, opts?: unknown) => Promise<string>>()
  .mockResolvedValue('https://signed-put.example.com/upload');
const mockHead =
  vi.fn<(k: string) => Promise<{ size: number; contentType: string | null } | null>>();
const mockDelete = vi.fn<(k: string) => Promise<void>>();
const mockGetSignedUrl = vi
  .fn<(k: string, expiresIn?: number) => Promise<string>>()
  .mockResolvedValue('https://signed-get.example.com/download');

vi.mock('$server/storage/blob', () => ({
  getStorage: () => ({
    presignPut: (k: string, ct: string, e?: number, o?: unknown) => mockPresignPut(k, ct, e, o),
    head: (k: string) => mockHead(k),
    delete: (k: string) => mockDelete(k),
    getSignedUrl: (k: string, e?: number) => mockGetSignedUrl(k, e),
    put: vi.fn(),
  }),
}));

const ctx = (db: unknown) => ({ db: db as never, tenantId: 'org-1' });
const CONTACT_ID = '11111111-1111-4111-8111-111111111111';

describe('createUploadIntent', () => {
  it('rejects a file over the size cap without touching storage', async () => {
    const { db } = createMockDb();
    await expect(
      createUploadIntent(ctx(db), {
        fileName: 'huge.zip',
        contentType: 'application/zip',
        sizeBytes: 999_999_999,
      }),
    ).rejects.toThrow(AttachmentError);
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  it('rejects a disallowed MIME type', async () => {
    const { db } = createMockDb();
    await expect(
      createUploadIntent(ctx(db), {
        fileName: 'script.exe',
        contentType: 'application/x-msdownload',
        sizeBytes: 100,
      }),
    ).rejects.toMatchObject({ code: 'mime_not_allowed' });
  });

  it('rejects when the org quota would be exceeded', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ total: 2 * 1024 * 1024 * 1024 - 10 }]); // quota check
    await expect(
      createUploadIntent(ctx(db), {
        fileName: 'ok.pdf',
        contentType: 'application/pdf',
        sizeBytes: 1000,
      }),
    ).rejects.toThrow(/quota/i);
    expect(mockPresignPut).not.toHaveBeenCalled();
  });

  it('inserts a files row and returns a presigned PUT url', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ total: 0 }], // quota check
      [], // insert files
    ]);
    const intent = await createUploadIntent(ctx(db), {
      fileName: 'doc.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
    });
    expect(intent.fileId).toBe('mock-file-id-0000000001');
    expect(intent.uploadUrl).toBe('https://signed-put.example.com/upload');
    expect(mockPresignPut).toHaveBeenCalledWith(
      expect.stringContaining('org-1/attachments/mock-file-id-0000000001/doc.pdf'),
      'application/pdf',
      900,
      { contentLength: 1000 },
    );
  });
});

describe('finalizeUpload', () => {
  it('deletes the files row and throws upload_missing when the object never landed', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'f1', b2FileKey: 'org-1/attachments/f1/doc.pdf' }], // select file
      [], // delete files
    ]);
    mockHead.mockResolvedValueOnce(null);
    await expect(finalizeUpload(ctx(db), { fileId: 'f1' })).rejects.toMatchObject({
      code: 'upload_missing',
    });
  });

  it('throws not_found for an unknown fileId', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // select file -> none
    await expect(finalizeUpload(ctx(db), { fileId: 'missing' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('updates size_bytes to the real object size and links requested objects', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ id: 'f1', b2FileKey: 'org-1/attachments/f1/doc.pdf' }], // select file
      [], // update size
      [], // insert link
      [], // audit
    ]);
    mockHead.mockResolvedValueOnce({ size: 4321, contentType: 'application/pdf' });
    const result = await finalizeUpload(ctx(db), {
      fileId: 'f1',
      links: [{ objectType: 'crm_contact', objectId: CONTACT_ID }],
    });
    expect(result.sizeBytes).toBe(4321);
    expect(db.update).toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
  });
});

describe('linkAttachment', () => {
  it('inserts an idempotent link row and an audit entry', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([[], []]); // insert link, audit insert
    await linkAttachment(ctx(db), { fileId: 'f1', objectType: 'booking', objectId: CONTACT_ID });
    expect(db.insert).toHaveBeenCalled();
  });
});

describe('deleteAttachment', () => {
  it('refuses when links remain and force is not set', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ fileId: 'f1' }]); // link check finds a row
    await expect(deleteAttachment(ctx(db), 'f1')).rejects.toMatchObject({ code: 'still_linked' });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('deletes links, storage object, and the files row when forced', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ fileId: 'f1' }], // link check finds a row
      [{ b2FileKey: 'org-1/attachments/f1/doc.pdf' }], // select file
      [], // delete links
      [], // delete files
    ]);
    await deleteAttachment(ctx(db), 'f1', { force: true });
    expect(mockDelete).toHaveBeenCalledWith('org-1/attachments/f1/doc.pdf');
  });

  it('throws not_found when the file row is gone', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [], // no links
      [], // no file row
    ]);
    await expect(deleteAttachment(ctx(db), 'missing')).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});

describe('listAttachmentsFor', () => {
  it('returns [] without extra queries when nothing is linked', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // own links query
    const result = await listAttachmentsFor(ctx(db), 'crm_contact', CONTACT_ID);
    expect(result).toEqual([]);
  });

  it('groups every link (own + other objects) per file', async () => {
    const { db, resolveSequence } = createMockDb();
    resolveSequence([
      [{ fileId: 'f1' }], // own links
      [{ id: 'f1', b2FileKey: 'k', fileName: 'doc.pdf' }], // file rows
      [
        { fileId: 'f1', objectType: 'crm_contact', objectId: CONTACT_ID },
        { fileId: 'f1', objectType: 'booking', objectId: 'b-1' },
      ], // all links for f1
    ]);
    const result = await listAttachmentsFor(ctx(db), 'crm_contact', CONTACT_ID);
    expect(result).toHaveLength(1);
    expect(result[0].links).toEqual([
      { objectType: 'crm_contact', objectId: CONTACT_ID },
      { objectType: 'booking', objectId: 'b-1' },
    ]);
  });
});
