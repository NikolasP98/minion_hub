import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  uploadFile,
  getFileUrl,
  deleteFile,
  validateAttachment,
  assertOrgQuota,
  ATTACHMENT_LIMITS,
} from './file.service';
import { createMockDb } from '$server/test-utils/mock-db';

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('$server/db/utils', () => ({
  newId: () => 'mock-file-id-0000000001',
  nowMs: () => 1_700_000_000_000,
}));

const mockUploadToB2 =
  vi.fn<
    (
      k: string,
      b: Buffer | Uint8Array,
      ct: string,
      opts?: { cacheControl?: string },
    ) => Promise<void>
  >();
const mockGetSignedDownloadUrl = vi
  .fn<(k: string, expiresIn?: number) => Promise<string>>()
  .mockResolvedValue('https://signed-url.example.com/file');
const mockDeleteFromB2 = vi.fn<(k: string) => Promise<void>>();

vi.mock('$server/storage/blob', () => ({
  getStorage: () => ({
    put: (k: string, b: Buffer | Uint8Array, ct: string, opts?: { cacheControl?: string }) =>
      mockUploadToB2(k, b, ct, opts),
    getSignedUrl: (k: string, expiresIn?: number) => mockGetSignedDownloadUrl(k, expiresIn),
    delete: (k: string) => mockDeleteFromB2(k),
  }),
}));

describe('uploadFile', () => {
  it('calls uploadToB2 and db.insert', async () => {
    const { db } = createMockDb();
    const id = await uploadFile(
      { db: db as never, tenantId: 't1' },
      { fileName: 'test.pdf', contentType: 'application/pdf', data: Buffer.from('hi') },
    );
    expect(id).toBe('mock-file-id-0000000001');
    expect(mockUploadToB2).toHaveBeenCalledWith(
      't1/general/mock-file-id-0000000001/test.pdf',
      expect.any(Buffer),
      'application/pdf',
      { cacheControl: undefined },
    );
    expect(db.insert).toHaveBeenCalled();
  });

  it('defaults category to general', async () => {
    const { db } = createMockDb();
    await uploadFile(
      { db: db as never, tenantId: 't1' },
      { fileName: 'x.txt', contentType: 'text/plain', data: Buffer.from('data') },
    );
    // Verify the b2FileKey includes 'general'
    expect(mockUploadToB2).toHaveBeenCalledWith(
      expect.stringContaining('/general/'),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('passes cacheControl through to storage.put', async () => {
    const { db } = createMockDb();
    await uploadFile(
      { db: db as never, tenantId: 't1' },
      {
        fileName: 'thumb.jpg',
        contentType: 'image/jpeg',
        data: Buffer.from('img'),
        category: 'meta/ig',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    );
    expect(mockUploadToB2).toHaveBeenCalledWith(
      expect.stringContaining('/meta/ig/'),
      expect.any(Buffer),
      'image/jpeg',
      { cacheControl: 'public, max-age=31536000, immutable' },
    );
  });
});

describe('getFileUrl', () => {
  it('returns null when file not found', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // no rows
    const result = await getFileUrl({ db: db as never, tenantId: 't1' }, 'no-such-id');
    expect(result).toBe(null);
  });

  it('returns file with signed URL when found', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'f1', b2FileKey: 'key', fileName: 'test.pdf' }]);
    const result = await getFileUrl({ db: db as never, tenantId: 't1' }, 'f1');
    expect(result).not.toBe(null);
    expect(result!.url).toBe('https://signed-url.example.com/file');
    expect(mockGetSignedDownloadUrl).toHaveBeenCalledWith('key', undefined);
  });

  it('passes expiresIn through to storage.getSignedUrl', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ id: 'f1', b2FileKey: 'key', fileName: 'test.pdf' }]);
    await getFileUrl({ db: db as never, tenantId: 't1' }, 'f1', 86_400);
    expect(mockGetSignedDownloadUrl).toHaveBeenCalledWith('key', 86_400);
  });
});

describe('deleteFile', () => {
  it('does nothing when file not found', async () => {
    const { db, resolve } = createMockDb();
    resolve([]); // no rows
    await deleteFile({ db: db as never, tenantId: 't1' }, 'no-such-id');
    expect(mockDeleteFromB2).not.toHaveBeenCalled();
  });

  it('calls deleteFromB2 then db.delete when found', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ b2FileKey: 'some/key' }]);
    await deleteFile({ db: db as never, tenantId: 't1' }, 'f1');
    expect(mockDeleteFromB2).toHaveBeenCalledWith('some/key');
    expect(db.delete).toHaveBeenCalled();
  });
});

describe('validateAttachment', () => {
  it('accepts an allowed MIME type under the default cap', () => {
    expect(
      validateAttachment({ fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1000 }),
    ).toEqual({ ok: true });
  });

  it('rejects a file over the default (presigned) cap', () => {
    const result = validateAttachment({
      fileName: 'a.pdf',
      contentType: 'application/pdf',
      sizeBytes: ATTACHMENT_LIMITS.maxFileBytes + 1,
    });
    expect(result).toEqual({ ok: false, code: 'too_large', message: expect.any(String) });
  });

  it('rejects a file over a caller-supplied cap (proxied path)', () => {
    const result = validateAttachment(
      { fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 5 * 1024 * 1024 },
      { maxBytes: ATTACHMENT_LIMITS.proxiedMaxBytes },
    );
    expect(result.ok).toBe(false);
  });

  it('rejects a disallowed MIME type', () => {
    const result = validateAttachment({
      fileName: 'a.exe',
      contentType: 'application/x-msdownload',
      sizeBytes: 10,
    });
    expect(result).toEqual({
      ok: false,
      code: 'mime_not_allowed',
      message: expect.any(String),
    });
  });
});

describe('assertOrgQuota', () => {
  it('passes when the org is well under quota', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ total: 1000 }]);
    const result = await assertOrgQuota({ db: db as never, tenantId: 't1' }, 500);
    expect(result).toEqual({ ok: true });
  });

  it('fails when adding the file would exceed the org quota', async () => {
    const { db, resolve } = createMockDb();
    resolve([{ total: ATTACHMENT_LIMITS.orgQuotaBytes - 10 }]);
    const result = await assertOrgQuota({ db: db as never, tenantId: 't1' }, 1000);
    expect(result).toEqual({ ok: false, code: 'quota_exceeded', message: expect.any(String) });
  });
});
